import type { Protocol } from "devtools-protocol";
import { CdpConnection } from "./cdp";
import { Page } from "./page";

type TargetId = string;
type SessionId = string;

type TargetType = "page" | "iframe" | string;

function isTopLevelPage(info: Protocol.Target.TargetInfo): boolean {
  const ti = info as unknown as { subtype?: string };
  return info.type === "page" && ti.subtype !== "iframe";
}

/**
 * V3Context
 *
 * Purpose:
 * Single place that owns the **root CDP connection** and wires CDP Target/Page
 * events into Page/FrameGraph domain logic. It maintains one `Page` per
 * top-level target, and **adopts OOPIF child sessions** into the owning Page.
 *
 * Responsibilities:
 * - Bootstrap: discover/attach existing targets, enable auto-attach, and explicitly
 *   attach on `Target.targetCreated` so OOPIFs never slip through.
 * - Pause → wire → resume: targets start paused (`waitForDebuggerOnStart`); we
 *   enable Page domain, probe/attach listeners, then resume with `runIfWaitingForDebugger`.
 * - Staged adoption: cache child sessions by their **child root frame id** and adopt
 *   when the parent emits `frameAttached` for that id.
 * - Keep mappings for lookups and debug stats (top-level mapping only in `mainFrameToTarget`).
 */
export class V3Context {
  private constructor(private readonly conn: CdpConnection) {}

  private pagesByTarget = new Map<TargetId, Page>();
  private mainFrameToTarget = new Map<string, TargetId>();
  private sessionOwnerPage = new Map<SessionId, Page>();
  private frameOwnerPage = new Map<string, Page>();
  private pendingOopifByMainFrame = new Map<string, SessionId>();
  private createdAtByTarget = new Map<TargetId, number>();
  private typeByTarget = new Map<TargetId, TargetType>();

  /**
   * Create a Context for a given CDP websocket URL and bootstrap target wiring.
   */
  static async create(wsUrl: string): Promise<V3Context> {
    const conn = await CdpConnection.connect(wsUrl);
    await conn.enableAutoAttach();
    const ctx = new V3Context(conn);
    await ctx.bootstrap();
    return ctx;
  }

  /**
   * Return top-level `Page`s (oldest → newest). OOPIF targets are not included.
   */
  pages(): Page[] {
    const rows: Array<{ tid: TargetId; page: Page; created: number }> = [];
    for (const [tid, page] of this.pagesByTarget) {
      if (this.typeByTarget.get(tid) === "page") {
        rows.push({ tid, page, created: this.createdAtByTarget.get(tid) ?? 0 });
      }
    }
    rows.sort((a, b) => a.created - b.created);
    return rows.map((r) => r.page);
  }

  /**
   * Resolve an owning `Page` by the **top-level main frame id**.
   * Note: child (OOPIF) roots are intentionally not present in this mapping.
   */
  resolvePageByMainFrameId(frameId: string): Page | undefined {
    const targetId = this.mainFrameToTarget.get(frameId);
    return targetId ? this.pagesByTarget.get(targetId) : undefined;
  }

  /**
   * Serialize the full frame tree for a given top-level main frame id.
   */
  async getFullFrameTreeByMainFrameId(
    rootMainFrameId: string,
  ): Promise<Protocol.Page.FrameTree> {
    const owner = this.resolvePageByMainFrameId(rootMainFrameId);
    if (!owner)
      throw new Error(`No Page found for mainFrameId=${rootMainFrameId}`);
    return owner.asProtocolFrameTree(rootMainFrameId);
  }

  /**
   * Close CDP and clear all mappings. Best-effort cleanup.
   */
  async close(): Promise<void> {
    await this.conn.close();
    this.pagesByTarget.clear();
    this.mainFrameToTarget.clear();
    this.sessionOwnerPage.clear();
    this.frameOwnerPage.clear();
    this.pendingOopifByMainFrame.clear();
    this.createdAtByTarget.clear();
    this.typeByTarget.clear();
  }

  /**
   * Bootstrap target lifecycle:
   * - Attach to existing targets.
   * - Attach on `Target.targetCreated` (fallback for OOPIFs).
   * - Handle auto-attach events.
   * - Clean up on detach/destroy.
   */
  private async bootstrap(): Promise<void> {
    // Index existing targets (main + any pre-existing child targets)
    const targets = await this.conn.getTargets();
    for (const t of targets) {
      try {
        const session = await this.conn.attachToTarget(t.targetId);
        await this.onAttachedToTarget(
          t as unknown as Protocol.Target.TargetInfo,
          session.id,
        );
      } catch {
        // ignore attach race
      }
    }

    // Fallback: explicitly attach when a target is created (covers OOPIFs that don't auto-attach reliably)
    this.conn.on<Protocol.Target.TargetCreatedEvent>(
      "Target.targetCreated",
      async (evt) => {
        const info = evt.targetInfo;
        // Skip noisy workers; everything else (page/iframe/fenced_frame/etc.) we attach to.
        if (
          info.type === "worker" ||
          info.type === "service_worker" ||
          info.type === "shared_worker"
        ) {
          return;
        }
        try {
          const session = await this.conn.attachToTarget(info.targetId);
          await this.onAttachedToTarget(info, session.id);
        } catch {
          // harmless if already attached or if target vanished
        }
      },
    );

    // Live attach via auto-attach (normal path)
    this.conn.on<Protocol.Target.AttachedToTargetEvent>(
      "Target.attachedToTarget",
      async (evt) => {
        await this.onAttachedToTarget(evt.targetInfo, evt.sessionId);
      },
    );

    // Live detach (clean up session from owner page & frame graph)
    this.conn.on<Protocol.Target.DetachedFromTargetEvent>(
      "Target.detachedFromTarget",
      (evt) => {
        this.onDetachedFromTarget(evt.sessionId, evt.targetId ?? null);
      },
    );

    // Destroyed targets (fallback cleanup by targetId)
    this.conn.on<Protocol.Target.TargetDestroyedEvent>(
      "Target.targetDestroyed",
      (evt) => {
        this.cleanupByTarget(evt.targetId);
      },
    );
  }

  /**
   * Handle a newly attached target (top-level or potential OOPIF):
   * - Enable Page domain and lifecycle events.
   * - If top-level → create Page, wire listeners, resume.
   * - Else → probe child root frame id via `Page.getFrameTree` and adopt immediately
   *   if the parent is known; otherwise stage until parent `frameAttached`.
   * - Resume the target only after listeners are wired.
   */
  private async onAttachedToTarget(
    info: Protocol.Target.TargetInfo,
    sessionId: SessionId,
  ): Promise<void> {
    const session = this.conn.getSession(sessionId);
    if (!session) return;

    const pageEnabled = await session
      .send("Page.enable")
      .then(() => true)
      .catch(() => false);
    if (!pageEnabled) {
      await session.send("Runtime.runIfWaitingForDebugger").catch(() => {});
      return;
    }
    await session
      .send("Page.setLifecycleEventsEnabled", { enabled: true })
      .catch(() => {});

    // Top-level detection stays the same
    if (isTopLevelPage(info)) {
      const page = await Page.create(session, info.targetId);
      this.wireSessionToOwnerPage(sessionId, page);
      this.pagesByTarget.set(info.targetId, page);
      this.mainFrameToTarget.set(page.mainFrameId(), info.targetId);
      this.sessionOwnerPage.set(sessionId, page);
      this.frameOwnerPage.set(page.mainFrameId(), page);
      this.typeByTarget.set(info.targetId, "page");
      if (!this.createdAtByTarget.has(info.targetId)) {
        this.createdAtByTarget.set(info.targetId, Date.now());
      }
      this.installFrameEventBridges(sessionId, page);
      await session.send("Runtime.runIfWaitingForDebugger").catch(() => {});
      return;
    }

    // 🔍 PROBE: treat any attach with Page domain as a potential OOPIF by checking its root frame id.
    try {
      const { frameTree } =
        await session.send<Protocol.Page.GetFrameTreeResponse>(
          "Page.getFrameTree",
        );
      const childMainId = frameTree.frame.id;

      console.log("[ATTACH] child target attached", {
        sessionId,
        targetType: info.type,
        url: info.url,
        childMainId,
      });

      const owner = this.frameOwnerPage.get(childMainId);
      if (owner) {
        console.log(
          "[ADOPT-IMMEDIATE] child",
          childMainId,
          "-> owner",
          this.findTargetIdByPage(owner),
        );
        owner.adoptOopifSession(session, childMainId);
        this.sessionOwnerPage.set(sessionId, owner);
        this.installFrameEventBridges(sessionId, owner);
      } else {
        console.log(
          "[STAGE] child",
          childMainId,
          "pending until parent frameAttached",
        );
        this.pendingOopifByMainFrame.set(childMainId, sessionId);
      }
    } catch (e) {
      console.log("[ATTACH] child probe failed (no Page.getFrameTree?)", {
        sessionId,
        type: info.type,
        err: String(e),
      });
    }

    await session.send("Runtime.runIfWaitingForDebugger").catch(() => {});
  }

  /**
   * Detach handler:
   * - Remove child session ownership and prune its subtree.
   * - If a top-level target, cleanup its `Page` and mappings.
   * - Drop any staged child for this session.
   */
  private onDetachedFromTarget(
    sessionId: SessionId,
    targetId: string | null,
  ): void {
    const owner = this.sessionOwnerPage.get(sessionId);
    if (owner) {
      owner.detachOopifSession(sessionId);
      this.sessionOwnerPage.delete(sessionId);
    }

    if (targetId && this.pagesByTarget.has(targetId)) {
      this.cleanupByTarget(targetId);
    }

    for (const [fid, sid] of Array.from(
      this.pendingOopifByMainFrame.entries(),
    )) {
      if (sid === sessionId) this.pendingOopifByMainFrame.delete(fid);
    }
  }

  /**
   * Cleanup a top-level Page by target id, removing its root and staged children.
   */
  private cleanupByTarget(targetId: TargetId): void {
    const page = this.pagesByTarget.get(targetId);
    if (!page) return;

    const mainId = page.mainFrameId();
    this.mainFrameToTarget.delete(mainId);
    this.frameOwnerPage.delete(mainId);

    for (const [sessionId, p] of Array.from(this.sessionOwnerPage.entries())) {
      if (p === page) this.sessionOwnerPage.delete(sessionId);
    }

    for (const [fid] of Array.from(this.pendingOopifByMainFrame.entries())) {
      const owner = this.frameOwnerPage.get(fid);
      if (!owner || owner === page) this.pendingOopifByMainFrame.delete(fid);
    }

    this.pagesByTarget.delete(targetId);
    this.createdAtByTarget.delete(targetId);
    this.typeByTarget.delete(targetId);
  }

  /**
   * Wire Page-domain frame events for a session into the owning Page & mappings.
   * - `frameAttached`: update topology, adopt any staged child, handle root swap mapping.
   * - `frameDetached`: prune on hard remove; keep node/mapping on `"swap"` handoff.
   * - `frameNavigated`: store last-seen frame metadata.
   */
  private installFrameEventBridges(sessionId: SessionId, owner: Page): void {
    const session = this.conn.getSession(sessionId);
    if (!session) return;

    session.on<Protocol.Page.FrameAttachedEvent>(
      "Page.frameAttached",
      (evt) => {
        const { frameId, parentFrameId } = evt;
        console.log("[PARENT frameAttached]", {
          sessionId,
          frameId,
          parentFrameId,
        });

        const oldRoot = owner.mainFrameId();
        owner.onFrameAttached(frameId, parentFrameId ?? null);

        // record the owner for this frame id first
        this.frameOwnerPage.set(frameId, owner);

        // If a child session was staged for THIS frame id, adopt now
        const pendingChildSessionId = this.pendingOopifByMainFrame.get(frameId);
        if (pendingChildSessionId) {
          const child = this.conn.getSession(pendingChildSessionId);
          if (child) {
            console.log(
              "[ADOPT-STAGED] child",
              frameId,
              "from session",
              pendingChildSessionId,
            );
            owner.adoptOopifSession(child, frameId);
            this.sessionOwnerPage.set(child.id, owner);
            // ✅ very important: wire child bridges now
            this.installFrameEventBridges(pendingChildSessionId, owner);
          } else {
            console.log(
              "[ADOPT-STAGED] child session is gone",
              pendingChildSessionId,
            );
          }
          this.pendingOopifByMainFrame.delete(frameId);
        }

        // Root swap: move top-level mapping to new main id
        if (!parentFrameId) {
          const newRoot = owner.mainFrameId();
          if (newRoot !== oldRoot) {
            const topTargetId = this.findTargetIdByPage(owner);
            if (topTargetId) {
              this.mainFrameToTarget.delete(oldRoot);
              this.mainFrameToTarget.set(newRoot, topTargetId);
            }
            this.frameOwnerPage.set(newRoot, owner);
          }
        }
      },
    );

    session.on<Protocol.Page.FrameDetachedEvent>(
      "Page.frameDetached",
      (evt) => {
        owner.onFrameDetached(evt.frameId, evt.reason ?? "remove");
        if (evt.reason !== "swap") {
          this.frameOwnerPage.delete(evt.frameId);
        }
      },
    );

    session.on<Protocol.Page.FrameNavigatedEvent>(
      "Page.frameNavigated",
      (evt) => {
        owner.onFrameNavigated(evt.frame);
      },
    );
  }

  /**
   * Register that a session belongs to a Page (used by event routing).
   */
  private wireSessionToOwnerPage(sessionId: SessionId, owner: Page): void {
    this.sessionOwnerPage.set(sessionId, owner);
  }

  /**
   * Utility: reverse-lookup the top-level target id that owns a given Page.
   */
  private findTargetIdByPage(page: Page): TargetId | undefined {
    for (const [tid, p] of this.pagesByTarget) {
      if (p === page) return tid;
    }
    return undefined;
  }
}

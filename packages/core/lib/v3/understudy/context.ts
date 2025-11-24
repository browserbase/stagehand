// lib/v3/understudy/context.ts
import { promises as fs } from "fs";
import type { Protocol } from "devtools-protocol";
import { v3Logger } from "../logger";
import { CdpConnection, CDPSessionLike } from "./cdp";
import { Page } from "./page";
import { installV3PiercerIntoSession } from "./piercer";
import { executionContexts } from "./executionContextRegistry";
import type { StagehandAPIClient } from "../api";
import { LocalBrowserLaunchOptions } from "../types/public";
import {
  StagehandInvalidArgumentError,
  TimeoutError,
  PageNotFoundError,
} from "../types/public/sdkErrors";

type TargetId = string;
type SessionId = string;

type TargetType = "page" | "iframe" | string;

type InitScriptSource<Arg> =
  | string
  | { path?: string; content?: string }
  | ((arg: Arg) => unknown);

async function normalizeInitScriptSource<Arg>(
  script: InitScriptSource<Arg>,
  arg?: Arg,
): Promise<string> {
  if (typeof script === "function") {
    const argString = Object.is(arg, undefined)
      ? "undefined"
      : JSON.stringify(arg);
    return `(${script.toString()})(${argString})`;
  }

  if (!Object.is(arg, undefined)) {
    throw new StagehandInvalidArgumentError(
      "context.addInitScript: 'arg' is only supported when passing a function.",
    );
  }

  if (typeof script === "string") {
    return script;
  }

  if (!script || typeof script !== "object") {
    throw new StagehandInvalidArgumentError(
      "context.addInitScript: provide a string, function, or an object with path/content.",
    );
  }

  if (typeof script.content === "string") {
    return script.content;
  }

  if (typeof script.path === "string" && script.path.trim()) {
    const raw = await fs.readFile(script.path, "utf8");
    return appendSourceURL(raw, script.path);
  }

  throw new StagehandInvalidArgumentError(
    "context.addInitScript: provide a string, function, or an object with path/content.",
  );
}

// Chrome surfaces injected scripts using a //# sourceURL tag; mirroring Playwright keeps
// stack traces and console errors pointing back to the preload file when path is used.
function appendSourceURL(source: string, filePath: string): string {
  const sanitized = filePath.replace(/\n/g, "");
  return `${source}\n//# sourceURL=${sanitized}`;
}

function isTopLevelPage(info: Protocol.Target.TargetInfo): boolean {
  const ti = info as unknown as { subtype?: string };
  return info.type === "page" && ti.subtype !== "iframe";
}

/**
 * V3Context
 *
 * Owns the root CDP connection and wires Target/Page events into Page.
 * Maintains one Page per top-level target, adopts OOPIF child sessions into the owner Page,
 * and tracks target→page and (root) frame→target mappings for lookups.
 *
 * IMPORTANT: FrameId → session ownership is managed inside Page (via its FrameRegistry).
 * Context never “guesses” owners; it simply forwards events (with the emitting session)
 * so Page can record the correct owner at event time.
 */
export class V3Context {
  private constructor(
    readonly conn: CdpConnection,
    private readonly env: "LOCAL" | "BROWSERBASE" = "LOCAL",
    private readonly apiClient: StagehandAPIClient | null = null,
    private readonly localBrowserLaunchOptions: LocalBrowserLaunchOptions | null = null,
  ) {}

  private readonly _piercerInstalled = new Set<string>();
  // Timestamp for most recent popup/open signal
  private _lastPopupSignalAt = 0;

  private sessionKey(session: CDPSessionLike): string {
    return session.id ?? "root";
  }
  private readonly _sessionInit = new Set<SessionId>();
  private pagesByTarget = new Map<TargetId, Page>();
  private mainFrameToTarget = new Map<string, TargetId>();
  private sessionOwnerPage = new Map<SessionId, Page>();
  private frameOwnerPage = new Map<string, Page>();
  private pendingOopifByMainFrame = new Map<string, SessionId>();
  private createdAtByTarget = new Map<TargetId, number>();
  private typeByTarget = new Map<TargetId, TargetType>();
  private _pageOrder: TargetId[] = [];
  private pendingCreatedTargetUrl = new Map<TargetId, string>();
  private readonly initScripts: string[] = [];

  /**
   * Create a Context for a given CDP websocket URL and bootstrap target wiring.
   */
  static async create(
    wsUrl: string,
    opts?: {
      env?: "LOCAL" | "BROWSERBASE";
      apiClient?: StagehandAPIClient | null;
      localBrowserLaunchOptions?: LocalBrowserLaunchOptions | null;
    },
  ): Promise<V3Context> {
    const conn = await CdpConnection.connect(wsUrl);
    const ctx = new V3Context(
      conn,
      opts?.env ?? "LOCAL",
      opts?.apiClient ?? null,
      opts?.localBrowserLaunchOptions ?? null,
    );
    await ctx.bootstrap();
    await ctx.waitForFirstTopLevelPage(5000);
    return ctx;
  }

  /**
   * Wait until at least one top-level Page has been created and registered.
   * We poll internal maps that bootstrap/onAttachedToTarget populate.
   */
  private async waitForFirstTopLevelPage(timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      // A top-level Page is present if typeByTarget has an entry "page"
      // and pagesByTarget has the corresponding Page object.
      for (const [tid, ttype] of this.typeByTarget) {
        if (ttype === "page") {
          const p = this.pagesByTarget.get(tid);
          if (p) return;
        }
      }
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new TimeoutError(
      "waitForFirstTopLevelPage (no top-level Page)",
      timeoutMs,
    );
  }

  private async waitForInitialTopLevelTargets(
    targetIds: TargetId[],
    timeoutMs = 3000,
  ): Promise<void> {
    if (!targetIds.length) return;
    const pending = new Set(targetIds);
    const deadline = Date.now() + timeoutMs;
    while (pending.size && Date.now() < deadline) {
      for (const tid of Array.from(pending)) {
        if (this.pagesByTarget.has(tid)) {
          pending.delete(tid);
        }
      }
      if (!pending.size) return;
      await new Promise((r) => setTimeout(r, 25));
    }
    if (pending.size) {
      v3Logger({
        category: "ctx",
        message: "Timed out waiting for existing top-level targets to attach",
        level: 2,
        auxiliary: {
          remainingTargets: {
            value: JSON.stringify(Array.from(pending)),
            type: "object",
          },
        },
      });
    }
  }

  private async ensurePiercer(session: CDPSessionLike): Promise<boolean> {
    const key = this.sessionKey(session);
    if (this._piercerInstalled.has(key)) return true;

    const installed = await installV3PiercerIntoSession(session);
    if (installed) {
      this._piercerInstalled.add(key);
    }
    return installed;
  }

  /** Mark a page target as the most-recent one (active). */
  private _pushActive(tid: TargetId): void {
    // remove prior entry if any
    const i = this._pageOrder.indexOf(tid);
    if (i !== -1) this._pageOrder.splice(i, 1);
    this._pageOrder.push(tid);
  }

  /** Remove a page target from the recency list (used on close). */
  private _removeFromOrder(tid: TargetId): void {
    const i = this._pageOrder.indexOf(tid);
    if (i !== -1) this._pageOrder.splice(i, 1);
  }

  /** Return the current active Page (most-recent page that still exists). */
  public activePage(): Page | undefined {
    // prune any stale ids from the tail
    for (let i = this._pageOrder.length - 1; i >= 0; i--) {
      const tid = this._pageOrder[i]!;
      const p = this.pagesByTarget.get(tid);
      if (p) return p;
      // stale — remove and continue
      this._pageOrder.splice(i, 1);
    }
    // fallback: pick the newest by createdAt if order is empty
    let newestTid: TargetId | undefined;
    let newestTs = -1;
    for (const [tid] of this.pagesByTarget) {
      const ts = this.createdAtByTarget.get(tid) ?? 0;
      if (ts > newestTs) {
        newestTs = ts;
        newestTid = tid;
      }
    }
    return newestTid ? this.pagesByTarget.get(newestTid) : undefined;
  }

  /** Explicitly mark a known Page as the most-recent active page (and focus it). */
  public setActivePage(page: Page): void {
    let targetId = page.targetId();
    if (this.pagesByTarget.get(targetId) !== page) {
      const lookup = this.findTargetIdByPage(page);
      if (!lookup) {
        v3Logger({
          category: "ctx",
          message: "setActivePage called with unknown Page",
          level: 2,
          auxiliary: {
            targetId: { value: String(targetId), type: "string" },
          },
        });
        return;
      }
      targetId = lookup;
    }

    this._pushActive(targetId);

    // Bring the tab to the foreground in headful Chrome (best effort).
    void this.conn.send("Target.activateTarget", { targetId }).catch(() => {});
  }

  public async addInitScript<Arg>(
    script: InitScriptSource<Arg>,
    arg?: Arg,
  ): Promise<void> {
    const source = await normalizeInitScriptSource(script, arg);
    this.initScripts.push(source);
    const pages = this.pages();
    await Promise.all(pages.map((page) => page.registerInitScript(source)));
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

  private async applyInitScriptsToPage(page: Page): Promise<void> {
    for (const source of this.initScripts) {
      await page.registerInitScript(source);
    }
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
    if (!owner) throw new PageNotFoundError(`mainFrameId=${rootMainFrameId}`);
    return owner.asProtocolFrameTree(rootMainFrameId);
  }

  /**
   * Create a new top-level page (tab) with the given URL and return its Page object.
   * Waits until the target is attached and registered.
   */
  public async newPage(url = "about:blank"): Promise<Page> {
    const { targetId } = await this.conn.send<{ targetId: string }>(
      "Target.createTarget",
      { url },
    );
    this.pendingCreatedTargetUrl.set(targetId, url);
    // Best-effort bring-to-front
    await this.conn.send("Target.activateTarget", { targetId }).catch(() => {});

    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const page = this.pagesByTarget.get(targetId);
      if (page) return page;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new TimeoutError(`newPage: target not attached (${targetId})`, 5000);
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
    this.pendingCreatedTargetUrl.clear();
  }

  /**
   * Bootstrap target lifecycle:
   * - Attach to existing targets.
   * - Attach on `Target.targetCreated` (fallback for OOPIFs).
   * - Handle auto-attach events.
   * - Clean up on detach/destroy.
   */
  private async bootstrap(): Promise<void> {
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
        // Note popups to help activePage settle
        const ti = info;
        if (info.type === "page" && (ti?.openerId || ti?.openerFrameId)) {
          this._notePopupSignal();
        }
        try {
          await this.conn.attachToTarget(info.targetId);
        } catch {
          // harmless if already attached or if target vanished
        }
      },
    );

    // Only enable auto-attach after listeners are ready so replayed targets are captured.
    await this.conn.enableAutoAttach();

    const targets = await this.conn.getTargets();
    for (const t of targets) {
      try {
        await this.conn.attachToTarget(t.targetId);
      } catch {
        // ignore attach race
      }
    }

    const topLevelTargetIds = targets
      .filter((t) => isTopLevelPage(t))
      .map((t) => t.targetId);
    await this.waitForInitialTopLevelTargets(topLevelTargetIds);
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

    // Init guard
    if (this._sessionInit.has(sessionId)) return;
    this._sessionInit.add(sessionId);
    await session.send("Runtime.runIfWaitingForDebugger").catch(() => {});

    // Register for Runtime events before enabling it so we don't miss initial contexts.
    executionContexts.attachSession(session);

    const piercerReady = await this.ensurePiercer(session);
    if (!piercerReady) return;

    await session
      .send("Page.setLifecycleEventsEnabled", { enabled: true })
      .catch(() => {});

    // Top-level handling
    if (isTopLevelPage(info)) {
      const page = await Page.create(
        this.conn,
        session,
        info.targetId,
        this.apiClient,
        this.localBrowserLaunchOptions,
        this.env === "BROWSERBASE",
      );
      this.wireSessionToOwnerPage(sessionId, page);
      this.pagesByTarget.set(info.targetId, page);
      this.mainFrameToTarget.set(page.mainFrameId(), info.targetId);
      this.sessionOwnerPage.set(sessionId, page);
      this.frameOwnerPage.set(page.mainFrameId(), page);
      this.typeByTarget.set(info.targetId, "page");
      if (!this.createdAtByTarget.has(info.targetId)) {
        this.createdAtByTarget.set(info.targetId, Date.now());
      }
      const pendingSeedUrl = this.pendingCreatedTargetUrl.get(info.targetId);
      this.pendingCreatedTargetUrl.delete(info.targetId);
      page.seedCurrentUrl(pendingSeedUrl ?? info.url ?? "");
      this._pushActive(info.targetId);
      this.installFrameEventBridges(sessionId, page);
      await this.applyInitScriptsToPage(page);

      return;
    }

    // Child (iframe / OOPIF)
    try {
      const { frameTree } =
        await session.send<Protocol.Page.GetFrameTreeResponse>(
          "Page.getFrameTree",
        );
      const childMainId = frameTree.frame.id;

      // Try to find owner Page now (it may already have the node in its tree)
      let owner = this.frameOwnerPage.get(childMainId);
      if (!owner) {
        for (const p of this.pagesByTarget.values()) {
          const tree = p.asProtocolFrameTree(p.mainFrameId());
          const has = (function find(n: Protocol.Page.FrameTree): boolean {
            if (n.frame.id === childMainId) return true;
            for (const c of n.childFrames ?? []) if (find(c)) return true;
            return false;
          })(tree);
          if (has) {
            owner = p;
            break;
          }
        }
      }

      if (owner) {
        owner.adoptOopifSession(session, childMainId);
        this.sessionOwnerPage.set(sessionId, owner);
        this.installFrameEventBridges(sessionId, owner);
        // Prime the execution-context registry so later lookups succeed even if
        // the frame navigates before we issue a command.
        void executionContexts
          .waitForMainWorld(session, childMainId)
          .catch(() => {});
      } else {
        this.pendingOopifByMainFrame.set(childMainId, sessionId);
      }
    } catch {
      // page.getFrameTree failed. Most likely was an ad iframe
      // that opened & closed before we could attach. ignore
    }
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

    for (const [sid, p] of Array.from(this.sessionOwnerPage.entries())) {
      if (p === page) this.sessionOwnerPage.delete(sid);
    }

    for (const [fid] of Array.from(this.pendingOopifByMainFrame.entries())) {
      const owner = this.frameOwnerPage.get(fid);
      if (!owner || owner === page) this.pendingOopifByMainFrame.delete(fid);
    }

    this._removeFromOrder(targetId);
    this.pagesByTarget.delete(targetId);
    this.createdAtByTarget.delete(targetId);
    this.typeByTarget.delete(targetId);
    this.pendingCreatedTargetUrl.delete(targetId);
  }

  /**
   * Wire Page-domain frame events for a session into the owning Page & mappings.
   * We forward the *emitting session* with every event so Page can stamp ownership precisely.
   */
  private installFrameEventBridges(sessionId: SessionId, owner: Page): void {
    const session = this.conn.getSession(sessionId);
    if (!session) return;

    session.on<Protocol.Page.FrameAttachedEvent>(
      "Page.frameAttached",
      (evt) => {
        const { frameId, parentFrameId } = evt;

        owner.onFrameAttached(frameId, parentFrameId ?? null, session);

        // If we were waiting for this id (OOPIF child), adopt now.
        const pendingChildSessionId = this.pendingOopifByMainFrame.get(frameId);
        if (pendingChildSessionId) {
          const child = this.conn.getSession(pendingChildSessionId);
          if (child) {
            owner.adoptOopifSession(child, frameId);
            this.sessionOwnerPage.set(child.id, owner);
            // Wire bridges for the child so its Page events keep flowing.
            this.installFrameEventBridges(pendingChildSessionId, owner);
          }
          this.pendingOopifByMainFrame.delete(frameId);
        }

        // Track Page ownership for quick reverse lookups (debug helpers).
        this.frameOwnerPage.set(frameId, owner);

        // Root handoff: keep mainFrameToTarget aligned for the page
        if (!parentFrameId) {
          const newRoot = owner.mainFrameId();
          const topTargetId = this.findTargetIdByPage(owner);
          if (topTargetId) {
            this.mainFrameToTarget.set(newRoot, topTargetId);
          }
          this.frameOwnerPage.set(newRoot, owner);
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
        owner.onFrameNavigated(evt.frame, session);
      },
    );

    session.on<Protocol.Page.NavigatedWithinDocumentEvent>(
      "Page.navigatedWithinDocument",
      (evt) => {
        owner.onNavigatedWithinDocument(evt.frameId, evt.url, session);
      },
    );

    // Observe window.open to anticipate default page changes
    session.on<Protocol.Page.WindowOpenEvent>("Page.windowOpen", () => {
      this._notePopupSignal();
    });
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

  private _notePopupSignal(): void {
    this._lastPopupSignalAt = Date.now();
  }

  /**
   * Await the current active page, waiting briefly if a popup/open was just triggered.
   * Normal path returns immediately; popup path waits up to timeoutMs for the new page.
   */
  async awaitActivePage(timeoutMs?: number): Promise<Page> {
    const defaultTimeout = this.env === "BROWSERBASE" ? 4000 : 2000;
    timeoutMs = timeoutMs ?? defaultTimeout;
    // If a popup was just triggered, Chrome (especially on Browserbase)
    // may briefly pause new targets at document start ("waiting for debugger").
    const recentWindowMs = this.env === "BROWSERBASE" ? 1000 : 300;
    const now = Date.now();
    const hasRecentPopup = now - this._lastPopupSignalAt <= recentWindowMs;

    const immediate = this.activePage();
    if (!hasRecentPopup && immediate) return immediate;

    const deadline = now + timeoutMs;
    while (Date.now() < deadline) {
      // Prefer most-recent by createdAt
      let newestTid: TargetId | undefined;
      let newestTs = -1;
      for (const [tid] of this.pagesByTarget) {
        const ts = this.createdAtByTarget.get(tid) ?? 0;
        if (ts > newestTs) {
          newestTs = ts;
          newestTid = tid;
        }
      }
      if (newestTid) {
        const p = this.pagesByTarget.get(newestTid);
        if (p && newestTs >= this._lastPopupSignalAt) return p;
      }
      await new Promise((r) => setTimeout(r, 25));
    }
    if (immediate) return immediate;
    throw new PageNotFoundError("awaitActivePage: no page available");
  }
}

// lib/v3/understudy/context.ts
import type { Protocol } from "devtools-protocol";
import { CdpConnection } from "./cdp";
import { Page } from "./page";

export class V3Context {
  private constructor(private readonly conn: CdpConnection) {}

  private pagesByTarget = new Map<string, Page>(); // targetId -> Page
  private mainFrameToTarget = new Map<string, string>(); // mainFrameId -> targetId
  private waitersByMainFrame = new Map<string, Array<(p: Page) => void>>();

  static async create(wsUrl: string): Promise<V3Context> {
    const conn = await CdpConnection.connect(wsUrl);
    await conn.enableAutoAttach(); // flattened sessions + discover targets
    const ctx = new V3Context(conn);
    await ctx.bootstrap();
    return ctx;
  }

  async close(): Promise<void> {
    await this.conn.close();
    this.pagesByTarget.clear();
    this.mainFrameToTarget.clear();
    this.waitersByMainFrame.clear();
  }

  resolvePageByMainFrameId(frameId: string): Page | undefined {
    const targetId = this.mainFrameToTarget.get(frameId);
    return targetId ? this.pagesByTarget.get(targetId) : undefined;
  }

  /** One-shot, event-driven wait until our auto-attach/indexing sets the mapping. */
  waitForPageByMainFrameId(frameId: string, timeoutMs = 5000): Promise<Page> {
    const existing = this.resolvePageByMainFrameId(frameId);
    if (existing) return Promise.resolve(existing);

    return new Promise<Page>((resolve, reject) => {
      const list = this.waitersByMainFrame.get(frameId) ?? [];
      list.push(resolve);
      this.waitersByMainFrame.set(frameId, list);

      if (timeoutMs > 0) {
        const timer = setTimeout(() => {
          // prune this waiter
          const arr = this.waitersByMainFrame.get(frameId);
          if (arr)
            this.waitersByMainFrame.set(
              frameId,
              arr.filter((fn) => fn !== resolve),
            );
          reject(
            new Error(`Timed out waiting for V3 Page (mainFrameId=${frameId})`),
          );
        }, timeoutMs);

        // wrap resolve to clear the timer
        const orig = resolve;
        resolve = (p: Page) => {
          clearTimeout(timer);
          orig(p);
        };
      }
    });
  }

  // ---------- internals ----------

  private notifyMainFrameReady(mainFrameId: string, page: Page): void {
    const waiters = this.waitersByMainFrame.get(mainFrameId);
    if (!waiters?.length) return;
    this.waitersByMainFrame.delete(mainFrameId);
    for (const fn of waiters) fn(page);
  }

  private async bootstrap(): Promise<void> {
    // Eagerly attach and index existing page targets.
    const targets = await this.conn.getTargets();
    for (const t of targets) {
      if (t.type === "page") {
        const session = await this.conn.attachToTarget(t.targetId);
        await this.indexPageSession(session, t.targetId);
      }
    }

    // Real-time attach/detach
    this.conn.on<Protocol.Target.AttachedToTargetEvent>(
      "Target.attachedToTarget",
      async (evt) => {
        if (evt.targetInfo.type !== "page") return;
        const session = this.conn.getSession(evt.sessionId);
        if (!session) return;
        await this.indexPageSession(session, evt.targetInfo.targetId);
      },
    );

    const cleanup = (targetId: string): void => {
      const page = this.pagesByTarget.get(targetId);
      if (!page) return;
      // remove reverse index entries for this target
      for (const [fid, tid] of this.mainFrameToTarget.entries()) {
        if (tid === targetId) this.mainFrameToTarget.delete(fid);
      }
      this.pagesByTarget.delete(targetId);
      // no waiter notifications on cleanup
    };

    this.conn.on<Protocol.Target.TargetDestroyedEvent>(
      "Target.targetDestroyed",
      (evt) => cleanup(evt.targetId),
    );
    this.conn.on<Protocol.Target.DetachedFromTargetEvent>(
      "Target.detachedFromTarget",
      (evt) => {
        if (evt.targetId) cleanup(evt.targetId);
      },
    );
  }

  private async indexPageSession(
    session: ReturnType<CdpConnection["attachToTarget"]> extends Promise<
      infer S
    >
      ? S
      : never,
    targetId: string,
  ): Promise<void> {
    if (this.pagesByTarget.has(targetId)) return; // idempotent

    // Ensure Page domain is on for consistent main-frame bookkeeping inside Page.create() if needed.
    await session.send("Page.enable").catch(() => {
      /* best-effort */
    });

    const page = await Page.create(session, targetId);
    const mainFrameId = page.mainFrame().frameId; // CDP main frame id (from OUR session)

    this.pagesByTarget.set(targetId, page);
    this.mainFrameToTarget.set(mainFrameId, targetId);
    this.notifyMainFrameReady(mainFrameId, page);
  }
}

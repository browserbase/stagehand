import { Protocol } from "devtools-protocol";
import type { CDPSessionLike } from "./cdp";
import { Frame } from "./frame";
import {
  computeAbsoluteXPathForNode,
  resolveNodeForLocationDeep,
} from "./a11y/snapshot";
import { FrameRegistry } from "./frameRegistry";
import { LoadState } from "../types";

/**
 * Page
 *
 * One instance per **top-level target**. It owns:
 *  - the top-level CDP session (for the page target)
 *  - all adopted OOPIF child sessions (Target.attachToTarget with flatten: true)
 *  - a **FrameRegistry** that is the single source of truth for BOTH:
 *      • frame topology (parent/children, root swaps, last-seen CDP Frame)
 *      • frame → session ownership (which session owns which frameId)
 *
 * Page exposes convenient APIs (goto/reload/url/screenshot/locator),
 * and simple bridges that Context uses to feed Page/Target events in.
 */
const LIFECYCLE_NAME: Record<LoadState, string> = {
  load: "load",
  domcontentloaded: "DOMContentLoaded",
  networkidle: "networkIdle",
};

export class Page {
  /** Every CDP child session this page owns (top-level + adopted OOPIF sessions). */
  private readonly sessions = new Map<string, CDPSessionLike>(); // sessionId -> session

  /** Unified truth for frame topology + ownership. */
  private readonly registry: FrameRegistry;

  /** A convenience wrapper bound to the current main frame id (top-level session). */
  private mainFrameWrapper: Frame;

  /** Compact ordinal per frameId (used by snapshot encoding). */
  private frameOrdinals = new Map<string, number>();
  private nextOrdinal = 0;

  /** cache Frames per frameId so everyone uses the same one */
  private readonly frameCache = new Map<string, Frame>();

  /** Stable id for Frames created by this Page (use top-level TargetId). */
  private readonly pageId: string;

  private constructor(
    private readonly mainSession: CDPSessionLike,
    private readonly _targetId: string,
    mainFrameId: string,
  ) {
    this.pageId = _targetId;

    // own the main session
    if (mainSession.id) this.sessions.set(mainSession.id, mainSession);

    // initialize registry with root/main frame id
    this.registry = new FrameRegistry(_targetId, mainFrameId);

    // main-frame wrapper is always bound to the **top-level** session
    this.mainFrameWrapper = new Frame(
      this.mainSession,
      mainFrameId,
      this.pageId,
    );
  }

  /**
   * Factory: create Page and seed registry with the shallow tree from Page.getFrameTree.
   * Assumes Page domain is already enabled on the session passed in.
   */
  static async create(
    session: CDPSessionLike,
    targetId: string,
  ): Promise<Page> {
    await session.send("Page.enable").catch(() => {});
    await session
      .send("Page.setLifecycleEventsEnabled", { enabled: true })
      .catch(() => {});
    const { frameTree } = await session.send<{
      frameTree: Protocol.Page.FrameTree;
    }>("Page.getFrameTree");
    const mainFrameId = frameTree.frame.id;

    const page = new Page(session, targetId, mainFrameId);

    // Seed topology + ownership for nodes known at creation time.
    page.registry.seedFromFrameTree(session.id ?? "root", frameTree);

    return page;
  }

  // ---------------- Event-driven updates from Context ----------------

  /**
   * Parent/child session emitted a `frameAttached`.
   * Topology update + ownership stamped to **emitting session**.
   */
  public onFrameAttached(
    frameId: string,
    parentId: string | null,
    session: CDPSessionLike,
  ): void {
    this.ensureOrdinal(frameId);
    this.registry.onFrameAttached(frameId, parentId, session.id ?? "root");
    // Cache is keyed by frameId → invalidate to ensure future frameForId resolves with latest owner
    this.frameCache.delete(frameId);
  }

  /**
   * Parent/child session emitted a `frameDetached`.
   */
  public onFrameDetached(
    frameId: string,
    reason: "remove" | "swap" | string = "remove",
  ): void {
    this.registry.onFrameDetached(frameId, reason);
    this.frameCache.delete(frameId);
  }

  /**
   * Parent/child session emitted a `frameNavigated`.
   * Topology + ownership update. Handles root swaps.
   */
  public onFrameNavigated(
    frame: Protocol.Page.Frame,
    session: CDPSessionLike,
  ): void {
    const prevRoot = this.mainFrameId();
    this.registry.onFrameNavigated(frame, session.id ?? "root");

    // If the root changed, keep the convenience wrapper in sync
    const newRoot = this.mainFrameId();
    if (newRoot !== prevRoot) {
      const oldOrd = this.frameOrdinals.get(prevRoot) ?? 0;
      this.frameOrdinals.set(newRoot, oldOrd);
      this.mainFrameWrapper = new Frame(this.mainSession, newRoot, this.pageId);
    }

    // Invalidate the cached Frame for this id (session may have changed)
    this.frameCache.delete(frame.id);
  }

  /**
   * An OOPIF child session whose **main** frame id equals the parent iframe’s frameId
   * has been attached; adopt the session into this Page and seed ownership for its subtree.
   */
  public adoptOopifSession(
    childSession: CDPSessionLike,
    childMainFrameId: string,
  ): void {
    if (childSession.id) this.sessions.set(childSession.id, childSession);

    // session will start emitting its own page events; mark ownership seed now
    this.registry.adoptChildSession(
      childSession.id ?? "child",
      childMainFrameId,
    );
    this.frameCache.delete(childMainFrameId);

    // Bridge events from the child session to keep registry in sync
    childSession.on<Protocol.Page.FrameNavigatedEvent>(
      "Page.frameNavigated",
      (evt) => {
        this.onFrameNavigated(evt.frame, childSession);
      },
    );
    childSession.on<Protocol.Page.FrameAttachedEvent>(
      "Page.frameAttached",
      (evt) => {
        this.onFrameAttached(
          evt.frameId,
          evt.parentFrameId ?? null,
          childSession,
        );
      },
    );
    childSession.on<Protocol.Page.FrameDetachedEvent>(
      "Page.frameDetached",
      (evt) => {
        this.onFrameDetached(evt.frameId, evt.reason ?? "remove");
      },
    );

    // One-shot seed the child's subtree ownership from its current tree
    void (async () => {
      try {
        await childSession.send("Page.enable").catch(() => {});
        let { frameTree } =
          await childSession.send<Protocol.Page.GetFrameTreeResponse>(
            "Page.getFrameTree",
          );

        // Normalize: ensure the child’s reported root id matches our known main id
        if (frameTree.frame.id !== childMainFrameId) {
          frameTree = {
            ...frameTree,
            frame: { ...frameTree.frame, id: childMainFrameId },
          };
        }

        this.registry.seedFromFrameTree(childSession.id ?? "child", frameTree);
      } catch {
        // If snapshot races, live events will still converge the registry.
      }
    })();
  }

  /** Detach an adopted child session and prune its subtree */
  public detachOopifSession(sessionId: string): void {
    // Find which frames were owned by this session and prune by tree starting from each root.
    for (const fid of this.registry.framesForSession(sessionId)) {
      this.registry.onFrameDetached(fid, "remove");
      this.frameCache.delete(fid);
    }
    this.sessions.delete(sessionId);
  }

  // ---------------- Ownership helpers / lookups ----------------

  /** Return the owning CDP session for a frameId (falls back to main session) */
  public getSessionForFrame(frameId: string): CDPSessionLike {
    const sid = this.registry.getOwnerSessionId(frameId);
    if (!sid) return this.mainSession;
    return this.sessions.get(sid) ?? this.mainSession;
  }

  /** Always returns a Frame bound to the owning session */
  public frameForId(frameId: string): Frame {
    const hit = this.frameCache.get(frameId);
    if (hit) return hit;

    const sess = this.getSessionForFrame(frameId);
    const f = new Frame(sess, frameId, this.pageId);
    this.frameCache.set(frameId, f);
    return f;
  }

  /** Expose a session by id (used by snapshot to resolve session id -> session) */
  public getSessionById(id: string): CDPSessionLike | undefined {
    return this.sessions.get(id);
  }

  // ---------------- MAIN APIs ----------------

  public targetId(): string {
    return this._targetId;
  }

  public mainFrameId(): string {
    return this.registry.mainFrameId();
  }

  public mainFrame(): Frame {
    return this.mainFrameWrapper;
  }

  public getFullFrameTree(): Protocol.Page.FrameTree {
    return this.asProtocolFrameTree(this.mainFrameId());
  }

  public asProtocolFrameTree(rootMainFrameId: string): Protocol.Page.FrameTree {
    return this.registry.asProtocolFrameTree(rootMainFrameId);
  }

  private ensureOrdinal(frameId: string): number {
    const hit = this.frameOrdinals.get(frameId);
    if (hit !== undefined) return hit;
    const ord = this.nextOrdinal++;
    this.frameOrdinals.set(frameId, ord);
    return ord;
  }

  /** Public getter for snapshot code / handlers. */
  public getOrdinal(frameId: string): number {
    return this.ensureOrdinal(frameId);
  }

  public listAllFrameIds(): string[] {
    return this.registry.listAllFrames();
  }

  // -------- Convenience APIs delegated to the current main frame --------

  /**
   * Navigate the page; optionally wait for a lifecycle state.
   * Waits on the **current** main frame and follows root swaps during navigation.
   */
  async goto(
    url: string,
    options?: { waitUntil?: LoadState; timeoutMs?: number },
  ): Promise<void> {
    await this.mainSession.send<Protocol.Page.NavigateResponse>(
      "Page.navigate",
      { url },
    );
    if (options?.waitUntil) {
      await this.waitForMainLoadState(
        options.waitUntil,
        options.timeoutMs ?? 15000,
      );
    }
  }

  /**
   * Reload the page; optionally wait for a lifecycle state.
   */
  async reload(options?: {
    waitUntil?: Exclude<"networkidle", "networkidle">;
  }): Promise<void> {
    await this.mainSession.send("Page.reload", { ignoreCache: false });
    if (options?.waitUntil) {
      await this.mainFrameWrapper.waitForLoadState(options.waitUntil);
    }
  }

  /**
   * Return the current page URL (from navigation history).
   */
  async url(): Promise<string> {
    const { entries, currentIndex } =
      await this.mainSession.send<Protocol.Page.GetNavigationHistoryResponse>(
        "Page.getNavigationHistory",
      );
    return entries[currentIndex]?.url ?? "";
  }

  /**
   * Capture a screenshot (delegated to the current main frame).
   */
  async screenshot(options?: { fullPage?: boolean }): Promise<string> {
    return this.mainFrameWrapper.screenshot(options);
  }

  /**
   * Create a locator bound to the current main frame.
   */
  locator(selector: string): ReturnType<Frame["locator"]> {
    return this.mainFrameWrapper.locator(selector);
  }

  /**
   * Click at absolute page coordinates (CSS pixels).
   * Dispatches mouseMoved → mousePressed → mouseReleased via CDP Input domain
   * on the top-level page target's session. Coordinates are relative to the
   * viewport origin (top-left). Does not scroll.
   */
  async click(
    x: number,
    y: number,
    options?: {
      button?: "left" | "right" | "middle";
      clickCount?: number;
      returnXpath?: boolean;
    },
  ): Promise<void | string> {
    const button = options?.button ?? "left";
    const clickCount = options?.clickCount ?? 1;

    let xpathResult: string | undefined;
    if (options?.returnXpath) {
      // Resolve the deepest node at the given coordinates (handles OOPIF)
      try {
        const hit = await resolveNodeForLocationDeep(this, x, y);
        if (hit) {
          console.log(
            `[Page.click] resolved hit frame=${hit.frameId} be=${hit.backendNodeId} at (${x}, ${y})`,
          );
          const xp = await computeAbsoluteXPathForNode(
            this,
            hit.frameId,
            hit.backendNodeId,
          );
          if (xp) xpathResult = xp;
          console.log(`[Page.click] resolved xpath: ${xpathResult}`);
        }
      } catch {
        // best-effort; fall through if any step fails
      }
    }

    // Synthesize a simple mouse move + press + release sequence
    await this.mainSession.send<never>("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x,
      y,
      button: "none",
    } as Protocol.Input.DispatchMouseEventRequest);

    await this.mainSession.send<never>("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x,
      y,
      button,
      clickCount,
    } as Protocol.Input.DispatchMouseEventRequest);

    await this.mainSession.send<never>("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x,
      y,
      button,
      clickCount,
    } as Protocol.Input.DispatchMouseEventRequest);

    if (options?.returnXpath) return xpathResult ?? "";
  }

  async scroll(
    x: number,
    y: number,
    deltaX: number,
    deltaY: number,
  ): Promise<void> {
    await this.mainSession.send<never>("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x,
      y,
      button: "none",
    } as Protocol.Input.DispatchMouseEventRequest);

    // Synthesize a simple mouse move + press + release sequence
    await this.mainSession.send<never>("Input.dispatchMouseEvent", {
      type: "mouseWheel",
      x,
      y,
      button: "none",
      deltaX,
      deltaY,
    } as Protocol.Input.DispatchMouseEventRequest);
  }

  // ---- Page-level lifecycle waiter that follows main frame id swaps ----

  /**
   * Create an isolated world for the **current** main frame and return its context id.
   */
  private async createIsolatedWorldForCurrentMain(): Promise<number> {
    await this.mainSession.send("Runtime.enable").catch(() => {});
    const { executionContextId } = await this.mainSession.send<{
      executionContextId: number;
    }>("Page.createIsolatedWorld", {
      frameId: this.mainFrameId(),
      worldName: "v3-world",
    });
    return executionContextId;
  }

  /**
   * Wait until the **current** main frame reaches a lifecycle state.
   * - Fast path via `document.readyState`.
   * - Event path listens at the session level and compares incoming `frameId`
   *   to `mainFrameId()` **at event time** to follow root swaps.
   */
  private async waitForMainLoadState(
    state: LoadState,
    timeoutMs = 15000,
  ): Promise<void> {
    await this.mainSession
      .send("Page.setLifecycleEventsEnabled", { enabled: true })
      .catch(() => {});

    // Fast path: check the *current* main frame's readyState.
    try {
      const ctxId = await this.createIsolatedWorldForCurrentMain();
      const { result } =
        await this.mainSession.send<Protocol.Runtime.EvaluateResponse>(
          "Runtime.evaluate",
          {
            expression: "document.readyState",
            contextId: ctxId,
            returnByValue: true,
          },
        );
      const rs = String(result?.value ?? "");
      if (
        (state === "domcontentloaded" &&
          (rs === "interactive" || rs === "complete")) ||
        (state === "load" && rs === "complete")
      ) {
        return;
      }
    } catch {
      // ignore fast-path failures
    }

    const wanted = LIFECYCLE_NAME[state];
    return new Promise<void>((resolve, reject) => {
      let done = false;
      let timer: ReturnType<typeof setTimeout> | null = null;

      const off = () => {
        this.mainSession.off("Page.lifecycleEvent", onLifecycle);
        this.mainSession.off("Page.domContentEventFired", onDomContent);
        this.mainSession.off("Page.loadEventFired", onLoad);
      };

      const finish = () => {
        if (done) return;
        done = true;
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        off();
        resolve();
      };

      const onLifecycle = (evt: Protocol.Page.LifecycleEventEvent) => {
        if (evt.name !== wanted) return;
        // Compare against the *current* main frame id when the event arrives.
        if (evt.frameId === this.mainFrameId()) finish();
      };

      const onDomContent = () => {
        if (state === "domcontentloaded") finish();
      };

      const onLoad = () => {
        if (state === "load") finish();
      };

      this.mainSession.on("Page.lifecycleEvent", onLifecycle);
      // Backups for sites that don't emit lifecycle consistently
      this.mainSession.on("Page.domContentEventFired", onDomContent);
      this.mainSession.on("Page.loadEventFired", onLoad);

      timer = setTimeout(() => {
        if (done) return;
        done = true;
        off();
        reject(
          new Error(
            `waitForMainLoadState(${state}) timed out after ${timeoutMs}ms`,
          ),
        );
      }, timeoutMs);
    });
  }
}

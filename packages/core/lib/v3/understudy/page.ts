import { Protocol } from "devtools-protocol";
import { v3Logger } from "../logger";
import type { CDPSessionLike } from "./cdp";
import { CdpConnection } from "./cdp";
import { Frame } from "./frame";
import { FrameLocator } from "./frameLocator";
import { deepLocatorFromPage } from "./deepLocator";
import { resolveXpathForLocation } from "./a11y/snapshot";
import { FrameRegistry } from "./frameRegistry";
import { LoadState } from "../types/public/page";
import { NetworkManager } from "./networkManager";
import { LifecycleWatcher } from "./lifecycleWatcher";

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
  /** Cached current URL for synchronous page.url() */
  private _currentUrl: string = "about:blank";

  private readonly networkManager: NetworkManager;

  private constructor(
    private readonly conn: CdpConnection,
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

    this.networkManager = new NetworkManager();
    this.networkManager.trackSession(this.mainSession);
  }

  // --- Optional visual cursor overlay management ---
  private cursorEnabled = false;
  private async ensureCursorScript(): Promise<void> {
    const script = `(() => {
      const ID = '__v3_cursor_overlay__';
      const state = { el: null, last: null };
      // Expose API early so move() calls before install are buffered
      try {
        if (!window.__v3Cursor || !window.__v3Cursor.__installed) {
          const api = {
            __installed: false,
            move(x, y) {
              if (state.el) {
                state.el.style.left = Math.max(0, x) + 'px';
                state.el.style.top = Math.max(0, y) + 'px';
              } else {
                state.last = [x, y];
              }
            },
            show() { if (state.el) state.el.style.display = 'block'; },
            hide() { if (state.el) state.el.style.display = 'none'; },
          };
          window.__v3Cursor = api;
        }
      } catch {}

      function install() {
        try {
          if (state.el) return; // already installed
          let el = document.getElementById(ID);
          if (!el) {
            const root = document.documentElement || document.body || document.head;
            if (!root) { setTimeout(install, 50); return; }
            el = document.createElement('div');
            el.id = ID;
            el.style.position = 'fixed';
            el.style.left = '0px';
            el.style.top = '0px';
            el.style.width = '16px';
            el.style.height = '24px';
            el.style.zIndex = '2147483647';
            el.style.pointerEvents = 'none';
            el.style.userSelect = 'none';
            el.style.mixBlendMode = 'normal';
            el.style.contain = 'layout style paint';
            el.style.willChange = 'transform,left,top';
            el.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="24" viewBox="0 0 16 24"><path d="M1 0 L1 22 L6 14 L15 14 Z" fill="black" stroke="white" stroke-width="0.7"/></svg>';
            root.appendChild(el);
          }
          state.el = el;
          try { window.__v3Cursor.__installed = true; } catch {}
          if (state.last) {
            window.__v3Cursor.move(state.last[0], state.last[1]);
            state.last = null;
          }
        } catch {}
      }

      if (document.readyState === 'complete' || document.readyState === 'interactive') {
        install();
      } else {
        document.addEventListener('DOMContentLoaded', install, { once: true });
        setTimeout(install, 100);
      }
    })();`;

    // Ensure future documents get the cursor at doc-start
    await this.mainSession
      .send("Page.addScriptToEvaluateOnNewDocument", { source: script })
      .catch(() => {});
    // Inject into current document now
    await this.mainSession
      .send("Runtime.evaluate", {
        expression: script,
        includeCommandLineAPI: false,
      })
      .catch(() => {});
  }

  public async enableCursorOverlay(): Promise<void> {
    if (this.cursorEnabled) return;
    await this.ensureCursorScript();
    this.cursorEnabled = true;
  }

  private async updateCursor(x: number, y: number): Promise<void> {
    if (!this.cursorEnabled) return;
    try {
      await this.mainSession.send("Runtime.evaluate", {
        expression: `typeof window.__v3Cursor!=="undefined"&&window.__v3Cursor.move(${Math.round(x)}, ${Math.round(y)})`,
      });
    } catch {
      //
    }
  }

  /**
   * Factory: create Page and seed registry with the shallow tree from Page.getFrameTree.
   * Assumes Page domain is already enabled on the session passed in.
   */
  static async create(
    conn: CdpConnection,
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

    const page = new Page(conn, session, targetId, mainFrameId);
    // Seed current URL from initial frame tree
    try {
      page._currentUrl = String(frameTree?.frame?.url ?? page._currentUrl);
    } catch {
      // ignore
    }

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

    // Update cached URL if this navigation pertains to the current main frame
    if (frame.id === this.mainFrameId()) {
      try {
        // Prefer frame.url; fallback keeps previous value
        this._currentUrl = String(
          (frame as { url?: string })?.url ?? this._currentUrl,
        );
      } catch {
        // ignore
      }
    }

    // Invalidate the cached Frame for this id (session may have changed)
    this.frameCache.delete(frame.id);
  }

  public onNavigatedWithinDocument(
    frameId: string,
    url: string,
    session: CDPSessionLike,
  ): void {
    const normalized = String(url ?? "").trim();
    if (!normalized) return;

    this.registry.onNavigatedWithinDocument(
      frameId,
      normalized,
      session.id ?? "root",
    );

    if (frameId === this.mainFrameId()) {
      this._currentUrl = normalized;
    }
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

    this.networkManager.trackSession(childSession);

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
    this.networkManager.untrackSession(sessionId);
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

  public registerSessionForNetwork(session: CDPSessionLike): void {
    this.networkManager.trackSession(session);
  }

  public unregisterSessionForNetwork(sessionId: string | undefined): void {
    this.networkManager.untrackSession(sessionId);
  }

  // ---------------- MAIN APIs ----------------

  public targetId(): string {
    return this._targetId;
  }

  /** Seed the cached URL before navigation events converge. */
  public seedCurrentUrl(url: string | undefined | null): void {
    if (!url) return;
    try {
      const normalized = String(url).trim();
      if (!normalized) return;
      this._currentUrl = normalized;
    } catch {
      // ignore invalid url seeds
    }
  }

  public mainFrameId(): string {
    return this.registry.mainFrameId();
  }

  public mainFrame(): Frame {
    return this.mainFrameWrapper;
  }

  /**
   * Close this top-level page (tab). Best-effort via Target.closeTarget.
   */
  public async close(): Promise<void> {
    try {
      await this.conn.send("Target.closeTarget", { targetId: this._targetId });
    } catch {
      // ignore
    }
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      try {
        const targets = await this.conn.getTargets();
        if (!targets.some((t) => t.targetId === this._targetId)) {
          this.networkManager.dispose();
          return;
        }
      } catch {
        // ignore and retry
      }
      await new Promise((r) => setTimeout(r, 25));
    }
    this.networkManager.dispose();
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
    const waitUntil: LoadState = options?.waitUntil ?? "domcontentloaded";
    const timeout = options?.timeoutMs ?? 15000;

    const watcher = new LifecycleWatcher({
      page: this,
      mainSession: this.mainSession,
      networkManager: this.networkManager,
      waitUntil,
      timeoutMs: timeout,
    });

    try {
      const response = await this.mainSession.send<Protocol.Page.NavigateResponse>(
        "Page.navigate",
        { url },
      );
      this._currentUrl = url;
      if (response?.loaderId) watcher.setExpectedLoaderId(response.loaderId);
      await watcher.wait();
    } finally {
      watcher.dispose();
    }
  }

  /**
   * Reload the page; optionally wait for a lifecycle state.
   */
  async reload(options?: {
    waitUntil?: LoadState;
    timeoutMs?: number;
    ignoreCache?: boolean;
  }): Promise<void> {
    const waitUntil = options?.waitUntil;
    const timeout = options?.timeoutMs ?? 15000;

    const watcher = waitUntil
      ? new LifecycleWatcher({
          page: this,
          mainSession: this.mainSession,
          networkManager: this.networkManager,
          waitUntil,
          timeoutMs: timeout,
        })
      : null;

    try {
      await this.mainSession.send("Page.reload", {
        ignoreCache: options?.ignoreCache ?? false,
      });

      if (watcher) {
        await watcher.wait();
      }
    } finally {
      watcher?.dispose();
    }
  }

  /**
   * Navigate back in history if possible; optionally wait for a lifecycle state.
   */
  async goBack(options?: {
    waitUntil?: LoadState;
    timeoutMs?: number;
  }): Promise<void> {
    const { entries, currentIndex } =
      await this.mainSession.send<Protocol.Page.GetNavigationHistoryResponse>(
        "Page.getNavigationHistory",
      );
    const prev = entries[currentIndex - 1];
    if (!prev) return; // nothing to do
    const waitUntil = options?.waitUntil;
    const timeout = options?.timeoutMs ?? 15000;

    const watcher = waitUntil
      ? new LifecycleWatcher({
          page: this,
          mainSession: this.mainSession,
          networkManager: this.networkManager,
          waitUntil,
          timeoutMs: timeout,
        })
      : null;

    try {
      await this.mainSession.send("Page.navigateToHistoryEntry", {
        entryId: prev.id,
      });
      this._currentUrl = prev.url ?? this._currentUrl;

      if (watcher) {
        await watcher.wait();
      }
    } finally {
      watcher?.dispose();
    }
  }

  /**
   * Navigate forward in history if possible; optionally wait for a lifecycle state.
   */
  async goForward(options?: {
    waitUntil?: LoadState;
    timeoutMs?: number;
  }): Promise<void> {
    const { entries, currentIndex } =
      await this.mainSession.send<Protocol.Page.GetNavigationHistoryResponse>(
        "Page.getNavigationHistory",
      );
    const next = entries[currentIndex + 1];
    if (!next) return; // nothing to do
    const waitUntil = options?.waitUntil;
    const timeout = options?.timeoutMs ?? 15000;

    const watcher = waitUntil
      ? new LifecycleWatcher({
          page: this,
          mainSession: this.mainSession,
          networkManager: this.networkManager,
          waitUntil,
          timeoutMs: timeout,
        })
      : null;

    try {
      await this.mainSession.send("Page.navigateToHistoryEntry", {
        entryId: next.id,
      });
      this._currentUrl = next.url ?? this._currentUrl;

      if (watcher) {
        await watcher.wait();
      }
    } finally {
      watcher?.dispose();
    }
  }

  /**
   * Return the current page URL (synchronous, cached from navigation events).
   */
  url(): string {
    return this._currentUrl;
  }

  /**
   * Return the current page title.
   * Prefers reading from the active document via Runtime.evaluate to reflect dynamic changes.
   * Falls back to navigation history title if evaluation is unavailable.
   */
  async title(): Promise<string> {
    try {
      await this.mainSession.send("Runtime.enable").catch(() => {});
      const ctxId = await this.createIsolatedWorldForCurrentMain();
      const { result } =
        await this.mainSession.send<Protocol.Runtime.EvaluateResponse>(
          "Runtime.evaluate",
          {
            expression: "document.title",
            contextId: ctxId,
            returnByValue: true,
          },
        );
      return String(result?.value ?? "");
    } catch {
      // Fallback: use navigation history entry title
      try {
        const { entries, currentIndex } =
          await this.mainSession.send<Protocol.Page.GetNavigationHistoryResponse>(
            "Page.getNavigationHistory",
          );
        return entries[currentIndex]?.title ?? "";
      } catch {
        return "";
      }
    }
  }

  /**
   * Capture a screenshot (delegated to the current main frame).
   */
  async screenshot(options?: { fullPage?: boolean }): Promise<Buffer> {
    return this.mainFrameWrapper.screenshot(options);
  }

  /**
   * Create a locator bound to the current main frame.
   */
  locator(selector: string): ReturnType<Frame["locator"]> {
    return this.mainFrameWrapper.locator(selector);
  }

  /**
   * Deep locator that supports cross-iframe traversal.
   * - Recognizes '>>' hop notation to enter iframe contexts.
   * - Supports deep XPath that includes iframe steps (e.g., '/html/body/iframe[2]//div').
   * Returns a Locator scoped to the appropriate frame.
   */
  deepLocator(selector: string) {
    return deepLocatorFromPage(this, this.mainFrameWrapper, selector);
  }

  /**
   * Frame locator similar to Playwright: targets iframe elements and scopes
   * subsequent locators to that frame. Supports chaining.
   */
  frameLocator(selector: string): FrameLocator {
    return new FrameLocator(this, selector);
  }

  /**
   * List all frames belonging to this page as Frame objects bound to their owning sessions.
   * The list is ordered by a stable ordinal assigned during the page lifetime.
   */
  frames(): Frame[] {
    const ids = this.listAllFrameIds();
    const withOrd = ids.map((id) => ({ id, ord: this.getOrdinal(id) }));
    withOrd.sort((a, b) => a.ord - b.ord);
    return withOrd.map(({ id }) => this.frameForId(id));
  }

  /**
   * Wait until the page reaches a lifecycle state on the current main frame.
   * Mirrors Playwright's API signatures.
   */
  async waitForLoadState(state: LoadState, timeoutMs?: number): Promise<void> {
    await this.waitForMainLoadState(state, timeoutMs ?? 15000);
  }

  /**
   * Evaluate a function or expression in the current main frame's isolated world.
   * - If a string is provided, it is treated as a JS expression.
   * - If a function is provided, it is stringified and invoked with the optional argument.
   * - The return value should be JSON-serializable. Non-serializable objects will
   *   best-effort serialize via JSON.stringify inside the page context.
   */
  async evaluate<R = unknown, Arg = unknown>(
    pageFunctionOrExpression: string | ((arg: Arg) => R | Promise<R>),
    arg?: Arg,
  ): Promise<R> {
    await this.mainSession.send("Runtime.enable").catch(() => {});
    const ctxId = await this.createIsolatedWorldForCurrentMain();

    const isString = typeof pageFunctionOrExpression === "string";
    let expression: string;

    if (isString) {
      expression = String(pageFunctionOrExpression);
    } else {
      const fnSrc = pageFunctionOrExpression.toString();
      // Build an IIFE that calls the user's function with the argument and
      // attempts to deep-serialize the result for returnByValue.
      const argJson = JSON.stringify(arg);
      expression = `(() => {
        const __fn = ${fnSrc};
        const __arg = ${argJson};
        try {
          const __res = __fn(__arg);
          return Promise.resolve(__res).then(v => {
            try { return JSON.parse(JSON.stringify(v)); } catch { return v; }
          });
        } catch (e) { throw e; }
      })()`;
    }

    const { result, exceptionDetails } =
      await this.mainSession.send<Protocol.Runtime.EvaluateResponse>(
        "Runtime.evaluate",
        {
          expression,
          contextId: ctxId,
          returnByValue: true,
          awaitPromise: true,
        },
      );

    if (exceptionDetails) {
      const msg =
        exceptionDetails.text ||
        exceptionDetails.exception?.description ||
        "Evaluation failed";
      throw new Error(msg);
    }

    return result?.value as R;
  }

  /**
   * Force the page viewport to an exact CSS size and device scale factor.
   * Ensures screenshots match width x height pixels when deviceScaleFactor = 1.
   */
  async setViewportSize(
    width: number,
    height: number,
    options?: { deviceScaleFactor?: number },
  ): Promise<void> {
    const dsf = Math.max(0.01, options?.deviceScaleFactor ?? 1);
    await this.mainSession
      .send("Emulation.setDeviceMetricsOverride", {
        width,
        height,
        deviceScaleFactor: dsf,
        mobile: false,
        screenWidth: width,
        screenHeight: height,
        positionX: 0,
        positionY: 0,
        scale: 1,
      } as Protocol.Emulation.SetDeviceMetricsOverrideRequest)
      .catch(() => {});

    // Best-effort ensure visible size in headless
    await this.mainSession
      .send("Emulation.setVisibleSize", { width, height })
      .catch(() => {});
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
    options: {
      button?: "left" | "right" | "middle";
      clickCount?: number;
      returnXpath: true;
    },
  ): Promise<string>;
  async click(
    x: number,
    y: number,
    options?: {
      button?: "left" | "right" | "middle";
      clickCount?: number;
      returnXpath?: false;
    },
  ): Promise<void>;
  async click(
    x: number,
    y: number,
    options: {
      button?: "left" | "right" | "middle";
      clickCount?: number;
      returnXpath: boolean;
    },
  ): Promise<void | string>;
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
      // Resolve the deepest node at the given coordinates and compute absolute XPath efficiently
      try {
        const hit = await resolveXpathForLocation(this, x, y);
        if (hit) {
          v3Logger({
            category: "page",
            message: "click resolved hit",
            level: 2,
            auxiliary: {
              frameId: { value: String(hit.frameId), type: "string" },
              backendNodeId: {
                value: String(hit.backendNodeId),
                type: "string",
              },
              x: { value: String(x), type: "integer" },
              y: { value: String(y), type: "integer" },
            },
          });
          xpathResult = hit.absoluteXPath;
          v3Logger({
            category: "page",
            message: `click resolved xpath`,
            level: 2,
            auxiliary: {
              xpath: { value: String(xpathResult ?? ""), type: "string" },
            },
          });
        }
      } catch {
        // best-effort; fall through if any step fails
      }
    }

    // Synthesize a simple mouse move + press + release sequence
    await this.updateCursor(x, y);
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
    options: { returnXpath: true },
  ): Promise<string>;
  async scroll(
    x: number,
    y: number,
    deltaX: number,
    deltaY: number,
    options?: { returnXpath?: false },
  ): Promise<void>;
  async scroll(
    x: number,
    y: number,
    deltaX: number,
    deltaY: number,
    options: { returnXpath: boolean },
  ): Promise<void | string>;
  async scroll(
    x: number,
    y: number,
    deltaX: number,
    deltaY: number,
    options?: { returnXpath?: boolean },
  ): Promise<void | string> {
    let xpathResult: string | undefined;
    if (options?.returnXpath) {
      try {
        const hit = await resolveXpathForLocation(this, x, y);
        if (hit) xpathResult = hit.absoluteXPath;
      } catch {
        // best-effort
      }
    }

    await this.updateCursor(x, y);
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

    if (options?.returnXpath) return xpathResult ?? "";
  }

  /**
   * Drag from (fromX, fromY) to (toX, toY) using mouse events.
   * Sends mouseMoved → mousePressed → mouseMoved (steps) → mouseReleased.
   */
  async dragAndDrop(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    options: {
      button?: "left" | "right" | "middle";
      steps?: number;
      delay?: number;
      returnXpath: true;
    },
  ): Promise<[string, string]>;
  async dragAndDrop(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    options?: {
      button?: "left" | "right" | "middle";
      steps?: number;
      delay?: number;
      returnXpath?: false;
    },
  ): Promise<void>;
  async dragAndDrop(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    options: {
      button?: "left" | "right" | "middle";
      steps?: number;
      delay?: number;
      returnXpath: boolean;
    },
  ): Promise<void | [string, string]>;
  async dragAndDrop(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    options?: {
      button?: "left" | "right" | "middle";
      steps?: number;
      delay?: number;
      returnXpath?: boolean;
    },
  ): Promise<void | [string, string]> {
    const button = options?.button ?? "left";
    const steps = Math.max(1, Math.floor(options?.steps ?? 1));
    const delay = Math.max(0, options?.delay ?? 0);

    const sleep = (ms: number) =>
      new Promise<void>((r) => (ms > 0 ? setTimeout(r, ms) : r()));

    const buttonMask = (b: typeof button): number => {
      switch (b) {
        case "left":
          return 1;
        case "right":
          return 2;
        case "middle":
          return 4;
        default:
          return 1;
      }
    };

    let fromXpath: string | undefined;
    let toXpath: string | undefined;
    if (options?.returnXpath) {
      try {
        const start = await resolveXpathForLocation(this, fromX, fromY);
        if (start) fromXpath = start.absoluteXPath;
      } catch {
        //
      }
      try {
        const end = await resolveXpathForLocation(this, toX, toY);
        if (end) toXpath = end.absoluteXPath;
      } catch {
        //
      }
    }

    // Move to start
    await this.updateCursor(fromX, fromY);
    await this.mainSession.send<never>("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: fromX,
      y: fromY,
      button: "none",
    } as Protocol.Input.DispatchMouseEventRequest);

    // Press
    await this.mainSession.send<never>("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: fromX,
      y: fromY,
      button,
      buttons: buttonMask(button),
      clickCount: 1,
    } as Protocol.Input.DispatchMouseEventRequest);

    // Intermediate moves
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const x = fromX + (toX - fromX) * t;
      const y = fromY + (toY - fromY) * t;
      await this.updateCursor(x, y);
      await this.mainSession.send<never>("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x,
        y,
        button,
        buttons: buttonMask(button),
      } as Protocol.Input.DispatchMouseEventRequest);
      if (delay) await sleep(delay);
    }

    // Release at end
    await this.updateCursor(toX, toY);
    await this.mainSession.send<never>("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: toX,
      y: toY,
      button,
      buttons: buttonMask(button),
      clickCount: 1,
    } as Protocol.Input.DispatchMouseEventRequest);

    if (options?.returnXpath) return [fromXpath ?? "", toXpath ?? ""];
  }

  /**
   * Type a string by dispatching keyDown/keyUp events per character.
   * Focus must already be on the desired element. Uses CDP Input.dispatchKeyEvent
   * and never falls back to Input.insertText. Optional delay applies between
   * successive characters.
   */
  async type(
    text: string,
    options?: { delay?: number; withMistakes?: boolean },
  ): Promise<void> {
    const delay = Math.max(0, options?.delay ?? 0);
    const withMistakes = !!options?.withMistakes;

    const sleep = (ms: number) =>
      new Promise<void>((r) => (ms > 0 ? setTimeout(r, ms) : r()));

    const keyStroke = async (
      ch: string,
      override?: {
        key?: string;
        code?: string;
        windowsVirtualKeyCode?: number;
      },
    ) => {
      if (override) {
        const base: Protocol.Input.DispatchKeyEventRequest = {
          type: "keyDown",
          key: override.key,
          code: override.code,
          windowsVirtualKeyCode: override.windowsVirtualKeyCode,
        } as Protocol.Input.DispatchKeyEventRequest;
        await this.mainSession.send("Input.dispatchKeyEvent", base);
        await this.mainSession.send("Input.dispatchKeyEvent", {
          ...base,
          type: "keyUp",
        } as Protocol.Input.DispatchKeyEventRequest);
        return;
      }

      // Printable character: use text on keyDown to generate input
      const down: Protocol.Input.DispatchKeyEventRequest = {
        type: "keyDown",
        text: ch,
        unmodifiedText: ch,
      };
      await this.mainSession.send("Input.dispatchKeyEvent", down);
      await this.mainSession.send("Input.dispatchKeyEvent", {
        type: "keyUp",
      } as Protocol.Input.DispatchKeyEventRequest);
    };

    const pressBackspace = async () =>
      keyStroke("\b", {
        key: "Backspace",
        code: "Backspace",
        windowsVirtualKeyCode: 8,
      });

    const randomPrintable = (avoid: string): string => {
      const pool =
        "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .,;:'\"!?@#$%^&*()-_=+[]{}<>/\\|`~";
      let c = avoid;
      while (c === avoid) {
        c = pool[Math.floor(Math.random() * pool.length)];
      }
      return c;
    };

    for (const ch of text) {
      // Control keys that we explicitly map
      if (ch === "\n" || ch === "\r") {
        await keyStroke(ch, {
          key: "Enter",
          code: "Enter",
          windowsVirtualKeyCode: 13,
        });
      } else if (ch === "\t") {
        await keyStroke(ch, {
          key: "Tab",
          code: "Tab",
          windowsVirtualKeyCode: 9,
        });
      } else {
        if (withMistakes && Math.random() < 0.12) {
          // Type a wrong character, then backspace to correct
          const wrong = randomPrintable(ch);
          await keyStroke(wrong);
          if (delay) await sleep(delay);
          await pressBackspace();
          if (delay) await sleep(delay);
        }
        await keyStroke(ch);
      }

      if (delay) await sleep(delay);
    }
  }

  /**
   * Press a single key or key combination (keyDown then keyUp).
   * For printable characters, uses the text path on keyDown; for named keys, sets key/code/VK.
   * Supports key combinations with modifiers like "Cmd+A", "Ctrl+C", "Shift+Tab", etc.
   */
  async keyPress(key: string, options?: { delay?: number }): Promise<void> {
    const delay = Math.max(0, options?.delay ?? 0);
    const sleep = (ms: number) =>
      new Promise<void>((r) => (ms > 0 ? setTimeout(r, ms) : r()));

    // Split key combination by + but handle the special case of "+" key itself
    function split(keyString: string): string[] {
      // Special case: if the entire string is just "+", return it as-is
      if (keyString === "+") {
        return ["+"];
      }

      const keys: string[] = [];
      let building = "";
      for (const char of keyString) {
        if (char === "+" && building) {
          keys.push(building);
          building = "";
        } else {
          building += char;
        }
      }
      if (building) {
        keys.push(building);
      }
      return keys;
    }

    const tokens = split(key);
    const mainKey = tokens[tokens.length - 1];
    const modifierKeys = tokens.slice(0, -1);

    try {
      for (const modKey of modifierKeys) {
        await this.keyDown(modKey);
      }

      await this.keyDown(mainKey);
      if (delay) await sleep(delay);
      await this.keyUp(mainKey);

      for (let i = modifierKeys.length - 1; i >= 0; i--) {
        await this.keyUp(modifierKeys[i]);
      }
    } catch (error) {
      // Clear stuck modifiers on error to prevent affecting subsequent keyPress calls
      this._pressedModifiers.clear();
      throw error;
    }
  }

  // Track pressed modifier keys
  private _pressedModifiers = new Set<string>();

  /** Press a key down without releasing it */
  private async keyDown(key: string): Promise<void> {
    const normalizedKey = this.normalizeModifierKey(key);

    const modifierKeys = ["Alt", "Control", "Meta", "Shift"];
    if (modifierKeys.includes(normalizedKey)) {
      this._pressedModifiers.add(normalizedKey);
    }

    let modifiers = 0;
    if (this._pressedModifiers.has("Alt")) modifiers |= 1;
    if (this._pressedModifiers.has("Control")) modifiers |= 2;
    if (this._pressedModifiers.has("Meta")) modifiers |= 4;
    if (this._pressedModifiers.has("Shift")) modifiers |= 8;

    const named = this.getNamedKeys();

    if (normalizedKey.length === 1) {
      const hasNonShiftModifier =
        this._pressedModifiers.has("Alt") ||
        this._pressedModifiers.has("Control") ||
        this._pressedModifiers.has("Meta");
      if (hasNonShiftModifier) {
        // For accelerators (e.g., Cmd/Ctrl/Alt + key), do not send text. Use rawKeyDown with key/code/VK.
        const desc = this.describePrintableKey(normalizedKey);
        const macCommands = this.isMacOS()
          ? this.macCommandsFor(desc.code ?? "")
          : [];
        const req: Protocol.Input.DispatchKeyEventRequest = {
          type: "rawKeyDown",
          modifiers,
          key: desc.key,
          ...(desc.code ? { code: desc.code } : {}),
          ...(typeof desc.vk === "number"
            ? { windowsVirtualKeyCode: desc.vk }
            : {}),
          ...(macCommands.length ? { commands: macCommands } : {}),
        } as Protocol.Input.DispatchKeyEventRequest;
        await this.mainSession.send("Input.dispatchKeyEvent", req);
      } else {
        // Typing path (no non-Shift modifiers): send text to generate input
        await this.mainSession.send("Input.dispatchKeyEvent", {
          type: "keyDown",
          text: normalizedKey,
          unmodifiedText: normalizedKey,
          modifiers,
        } as Protocol.Input.DispatchKeyEventRequest);
      }
      return;
    }

    const entry = named[normalizedKey] ?? null;
    if (entry) {
      const macCommands = this.isMacOS() ? this.macCommandsFor(entry.code) : [];
      const includeText = !!entry.text && modifiers === 0;
      const keyDown: Protocol.Input.DispatchKeyEventRequest = {
        type: includeText ? "keyDown" : "rawKeyDown",
        key: entry.key,
        code: entry.code,
        windowsVirtualKeyCode: entry.vk,
        modifiers,
        ...(includeText
          ? {
              text: entry.text,
              unmodifiedText: entry.unmodifiedText ?? entry.text,
            }
          : {}),
        ...(macCommands.length ? { commands: macCommands } : {}),
      } as Protocol.Input.DispatchKeyEventRequest;
      await this.mainSession.send("Input.dispatchKeyEvent", keyDown);
      return;
    }

    // Fallback: send with key property only
    await this.mainSession.send("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: normalizedKey,
      modifiers,
    } as Protocol.Input.DispatchKeyEventRequest);
  }

  /** Release a pressed key */
  private async keyUp(key: string): Promise<void> {
    const normalizedKey = this.normalizeModifierKey(key);

    let modifiers = 0;
    if (this._pressedModifiers.has("Alt")) modifiers |= 1;
    if (this._pressedModifiers.has("Control")) modifiers |= 2;
    if (this._pressedModifiers.has("Meta")) modifiers |= 4;
    if (this._pressedModifiers.has("Shift")) modifiers |= 8;

    const modifierKeys = ["Alt", "Control", "Meta", "Shift"];
    if (modifierKeys.includes(normalizedKey)) {
      this._pressedModifiers.delete(normalizedKey);
    }

    const named = this.getNamedKeys();

    if (normalizedKey.length === 1) {
      const desc = this.describePrintableKey(normalizedKey);
      await this.mainSession.send("Input.dispatchKeyEvent", {
        type: "keyUp",
        key: desc.key,
        code: desc.code,
        windowsVirtualKeyCode:
          typeof desc.vk === "number" ? desc.vk : undefined,
        modifiers,
      } as Protocol.Input.DispatchKeyEventRequest);
      return;
    }

    const entry = named[normalizedKey] ?? null;
    if (entry) {
      await this.mainSession.send("Input.dispatchKeyEvent", {
        type: "keyUp",
        key: entry.key,
        code: entry.code,
        windowsVirtualKeyCode: entry.vk,
        modifiers,
      } as Protocol.Input.DispatchKeyEventRequest);
      return;
    }

    // Fallback: send with key property only
    await this.mainSession.send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: normalizedKey,
      modifiers,
    } as Protocol.Input.DispatchKeyEventRequest);
  }

  /** Normalize modifier key names to match CDP expectations */
  private normalizeModifierKey(key: string): string {
    const normalized = key.toLowerCase();
    switch (normalized) {
      case "cmd":
      case "command":
        // On Mac, Cmd is Meta; elsewhere map to Control for common shortcuts
        return this.isMacOS() ? "Meta" : "Control";
      case "win":
      case "windows":
        return "Meta";
      case "ctrl":
        return "Control";
      case "option":
        return "Alt";
      case "shift":
        return "Shift";
      default:
        return key;
    }
  }

  /**
   * Get the map of named keys with their properties
   */
  private getNamedKeys(): Record<
    string,
    {
      key: string;
      code: string;
      vk: number;
      text?: string;
      unmodifiedText?: string;
    }
  > {
    return {
      Enter: {
        key: "Enter",
        code: "Enter",
        vk: 13,
        text: "\r",
        unmodifiedText: "\r",
      },
      Tab: { key: "Tab", code: "Tab", vk: 9 },
      Backspace: { key: "Backspace", code: "Backspace", vk: 8 },
      Escape: { key: "Escape", code: "Escape", vk: 27 },
      Delete: { key: "Delete", code: "Delete", vk: 46 },
      ArrowLeft: { key: "ArrowLeft", code: "ArrowLeft", vk: 37 },
      ArrowUp: { key: "ArrowUp", code: "ArrowUp", vk: 38 },
      ArrowRight: { key: "ArrowRight", code: "ArrowRight", vk: 39 },
      ArrowDown: { key: "ArrowDown", code: "ArrowDown", vk: 40 },
      Home: { key: "Home", code: "Home", vk: 36 },
      End: { key: "End", code: "End", vk: 35 },
      PageUp: { key: "PageUp", code: "PageUp", vk: 33 },
      PageDown: { key: "PageDown", code: "PageDown", vk: 34 },
      // Modifier keys
      Alt: { key: "Alt", code: "AltLeft", vk: 18 },
      Control: { key: "Control", code: "ControlLeft", vk: 17 },
      Meta: { key: "Meta", code: "MetaLeft", vk: 91 },
      Shift: { key: "Shift", code: "ShiftLeft", vk: 16 },
    };
  }

  /**
   * Minimal description for printable keys (letters/digits/space) to provide code and VK.
   * Used when non-Shift modifiers are pressed to avoid sending text while keeping accelerator info.
   */
  private describePrintableKey(ch: string): {
    key: string;
    code?: string;
    vk?: number;
  } {
    const shiftDown = this._pressedModifiers.has("Shift");
    const isLetter = /^[a-zA-Z]$/.test(ch);
    const isDigit = /^[0-9]$/.test(ch);

    if (isLetter) {
      const upper = ch.toUpperCase();
      return {
        key: shiftDown ? upper : upper.toLowerCase(),
        code: `Key${upper}`,
        vk: upper.charCodeAt(0), // 'A'..'Z' => 65..90
      };
    }

    if (isDigit) {
      return {
        key: ch,
        code: `Digit${ch}`,
        vk: ch.charCodeAt(0), // '0'..'9' => 48..57
      };
    }

    if (ch === " ") {
      return { key: " ", code: "Space", vk: 32 };
    }

    // Fallback: just return the character as-is; VK best-effort from ASCII
    return {
      key: shiftDown ? ch.toUpperCase() : ch,
      vk: ch.toUpperCase().charCodeAt(0),
    };
  }

  private isMacOS(): boolean {
    try {
      return process.platform === "darwin";
    } catch {
      return false;
    }
  }

  /**
   * Return Chromium mac editing commands (without trailing ':') for a given code like 'KeyA'
   * Only used on macOS to trigger system editing shortcuts (e.g., selectAll, copy, paste...).
   */
  private macCommandsFor(code: string): string[] {
    if (!this.isMacOS()) return [];
    const parts: string[] = [];
    if (this._pressedModifiers.has("Shift")) parts.push("Shift");
    if (this._pressedModifiers.has("Control")) parts.push("Control");
    if (this._pressedModifiers.has("Alt")) parts.push("Alt");
    if (this._pressedModifiers.has("Meta")) parts.push("Meta");
    parts.push(code);
    const shortcut = parts.join("+");
    const table: Record<string, string | string[]> = {
      "Meta+KeyA": "selectAll:",
      "Meta+KeyC": "copy:",
      "Meta+KeyX": "cut:",
      "Meta+KeyV": "paste:",
      "Meta+KeyZ": "undo:",
    };
    const value = table[shortcut];
    if (!value) return [];
    const list = Array.isArray(value) ? value : [value];
    return list
      .filter((c) => !c.startsWith("insert"))
      .map((c) => c.substring(0, c.length - 1));
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
  async waitForMainLoadState(
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

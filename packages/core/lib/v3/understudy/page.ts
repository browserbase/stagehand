import { Protocol } from "devtools-protocol";
import { promises as fs } from "fs";
import { v3Logger } from "../logger";
import { logAction } from "../flowLogger";
import type { CDPSessionLike } from "./cdp";
import { CdpConnection } from "./cdp";
import { Frame } from "./frame";
import { FrameLocator } from "./frameLocator";
import { deepLocatorFromPage } from "./deepLocator";
import { resolveXpathForLocation } from "./a11y/snapshot";
import { FrameRegistry } from "./frameRegistry";
import { executionContexts } from "./executionContextRegistry";
import { LoadState } from "../types/public/page";
import { NetworkManager } from "./networkManager";
import { LifecycleWatcher } from "./lifecycleWatcher";
import { NavigationResponseTracker } from "./navigationResponseTracker";
import { Response, isSerializableResponse } from "./response";
import { ConsoleMessage, ConsoleListener } from "./consoleMessage";
import type { StagehandAPIClient } from "../api";
import type { LocalBrowserLaunchOptions } from "../types/public";
import type { Locator } from "./locator";
import {
  StagehandInvalidArgumentError,
  StagehandEvalError,
} from "../types/public/sdkErrors";
import { normalizeInitScriptSource } from "./initScripts";
import type {
  ScreenshotAnimationsOption,
  ScreenshotCaretOption,
  ScreenshotOptions,
  ScreenshotScaleOption,
} from "../types/public/screenshotTypes";
import {
  applyMaskOverlays,
  applyStyleToFrames,
  collectFramesForScreenshot,
  computeScreenshotScale,
  disableAnimations,
  hideCaret,
  normalizeScreenshotClip,
  runScreenshotCleanups,
  setTransparentBackground,
  withScreenshotTimeout,
  type ScreenshotCleanup,
} from "./screenshotUtils";
import { InitScriptSource } from "../types/private";
import {
  rand,
  sleep,
  generateTrajectory,
  getKeyCode,
  getVirtualKeyCode,
  getModifiersForChar,
  computeDelayForChar,
  type Point,
} from "./stealth";
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
  private readonly browserIsRemote: boolean;

  /** Stable id for Frames created by this Page (use top-level TargetId). */
  private readonly pageId: string;
  /** Cached current URL for synchronous page.url() */
  private _currentUrl: string = "about:blank";

  private navigationCommandSeq = 0;
  private latestNavigationCommandId = 0;

  private readonly networkManager: NetworkManager;
  /** Optional API client for routing page operations to the API */
  private readonly apiClient: StagehandAPIClient | null = null;
  private readonly consoleListeners = new Set<ConsoleListener>();
  private readonly consoleHandlers = new Map<
    string,
    (evt: Protocol.Runtime.ConsoleAPICalledEvent) => void
  >();
  /** Document-start scripts installed across every session this page owns. */
  private readonly initScripts: string[] = [];

  // mouse placement tracking
  private _mouseX: number = -1;
  private _mouseY: number = -1;
  // typing delays
  private _baseTypingDelayMin: number;
  private _baseTypingDelayMax: number;
  private _stealthInitialized: boolean = false;

  private constructor(
    private readonly conn: CdpConnection,
    private readonly mainSession: CDPSessionLike,
    private readonly _targetId: string,
    mainFrameId: string,
    apiClient?: StagehandAPIClient | null,
    browserIsRemote = false,
  ) {
    this.pageId = _targetId;
    this.apiClient = apiClient ?? null;
    this.browserIsRemote = browserIsRemote;

    // own the main session
    if (mainSession.id) this.sessions.set(mainSession.id, mainSession);

    // initialize registry with root/main frame id
    this.registry = new FrameRegistry(_targetId, mainFrameId);

    // main-frame wrapper is always bound to the **top-level** session
    this.mainFrameWrapper = new Frame(
      this.mainSession,
      mainFrameId,
      this.pageId,
      this.browserIsRemote,
      this,
    );

    this.networkManager = new NetworkManager();
    this.networkManager.trackSession(this.mainSession);

    // randomly choose what typing delay profile we want
    this._baseTypingDelayMin = rand(50, 100);
    this._baseTypingDelayMax = rand(this._baseTypingDelayMin + 50, 250);
  }

  // Send a single init script to a specific CDP session.
  private async installInitScriptOnSession(
    session: CDPSessionLike,
    source: string,
  ): Promise<void> {
    await session.send("Page.addScriptToEvaluateOnNewDocument", {
      source: source,
    });
  }

  // Replay every previously registered init script onto a newly adopted session.
  private async applyInitScriptsToSession(
    session: CDPSessionLike,
  ): Promise<void> {
    for (const source of this.initScripts) {
      await this.installInitScriptOnSession(session, source);
    }
  }

  // Register a new init script and fan it out to all active sessions for this page.
  public async registerInitScript(source: string): Promise<void> {
    if (this.initScripts.includes(source)) return;
    this.initScripts.push(source);

    const installs: Array<Promise<void>> = [];
    installs.push(this.installInitScriptOnSession(this.mainSession, source));
    for (const session of this.sessions.values()) {
      if (session === this.mainSession) continue;
      installs.push(this.installInitScriptOnSession(session, source));
    }
    await Promise.all(installs);
  }

  /**
   * Init stealth features for the page
   * - Moves cursor to random page point
   * - Should be called automatically on page creation.
   * - TODO: add mouse overlay
   */
  private async initStealth(): Promise<void> {
    if (this._stealthInitialized) return;
    await this.moveToRandomPagePoint();
    this._stealthInitialized = true;
  }

  /**
   * Update tracked mouse coordinates.
   * Call this if you move the mouse outside of stealth methods.
   */
  public updateMouseCoordinates(x: number, y: number): void {
    this._mouseX = x;
    this._mouseY = y;
  }

  /**
   * Get current tracked mouse position.
   */
  public getMousePosition(): { x: number; y: number } {
    return { x: this._mouseX, y: this._mouseY };
  }

  /**
   * Move mouse to target coordinates using human-like trajectory.
   * Falls back to direct move if trajectory generation fails.
   */
  public async stealthMoveTo(
    x: number,
    y: number,
    session?: CDPSessionLike,
  ): Promise<void> {
    const sess = session ?? this.mainSession;
    const startX = this._mouseX >= 0 ? this._mouseX : x;
    const startY = this._mouseY >= 0 ? this._mouseY : y;

    try {
      const { points, timings } = await generateTrajectory(
        [startX, startY] as Point,
        [x, y] as Point,
        { frequency: 60, frequencyRandomizer: 1 },
      );

      for (let i = 0; i < points.length; i++) {
        const point = points[i];
        if (!point) continue;

        const delay = i > 0 ? (timings[i] ?? 0) - (timings[i - 1] ?? 0) : 0;
        if (delay > 0) await sleep(delay);

        await sess.send("Input.dispatchMouseEvent", {
          type: "mouseMoved",
          x: point[0],
          y: point[1],
          button: "none",
          pointerType: "mouse",
        });
      }
    } catch (error) {
      v3Logger({
        category: "stealth",
        message: "Trajectory generation failed, falling back to direct move",
        level: 1,
        auxiliary: { error: { value: String(error), type: "string" } },
      });

      await sess.send("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x,
        y,
        button: "none",
        pointerType: "mouse",
      });
    }

    this.updateMouseCoordinates(x, y);
  }

  /**
   * Perform a stealth click at coordinates with realistic timing.
   */
  public async stealthClick(
    x: number,
    y: number,
    session?: CDPSessionLike,
    button: "left" | "right" | "middle" = "left",
  ): Promise<void> {
    const sess = session ?? this.mainSession;

    await sess.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x,
      y,
      button,
      clickCount: 1,
      pointerType: "mouse",
    });

    // Random hold duration (humans don't release instantly)
    await sleep(rand(50, 150));

    await sess.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x,
      y,
      button,
      clickCount: 1,
      pointerType: "mouse",
    });

    this.updateMouseCoordinates(x, y);
  }

  /**
   * Type a single character with proper key event sequence.
   */
  public async stealthTypeChar(
    char: string,
    session?: CDPSessionLike,
  ): Promise<void> {
    const sess = session ?? this.mainSession;
    const code = getKeyCode(char);
    const keyCode = getVirtualKeyCode(char);
    const modifiers = getModifiersForChar(char);

    await sess.send("Input.dispatchKeyEvent", {
      type: "rawKeyDown",
      modifiers,
      code,
      key: char,
      windowsVirtualKeyCode: keyCode,
      nativeVirtualKeyCode: keyCode,
    });

    await sess.send("Input.dispatchKeyEvent", {
      type: "char",
      modifiers,
      text: char,
      code,
      key: char,
      windowsVirtualKeyCode: keyCode,
      nativeVirtualKeyCode: keyCode,
    });

    // Small delay of pressing a key
    await sleep(rand(5, 30));

    await sess.send("Input.dispatchKeyEvent", {
      type: "keyUp",
      modifiers,
      code,
      key: char,
      windowsVirtualKeyCode: keyCode,
      nativeVirtualKeyCode: keyCode,
    });
  }

  /**
   * Type a full string with human-like delays between characters.
   */
  public async stealthTypeValue(
    value: string,
    session?: CDPSessionLike,
  ): Promise<void> {
    const sess = session ?? this.mainSession;
    for (let i = 0; i < value.length; i++) {
      const char = value[i]!;
      const nextChar = value[i + 1];

      await this.stealthTypeChar(char, sess);

      const delay = computeDelayForChar(
        char,
        this._baseTypingDelayMin,
        this._baseTypingDelayMax,
        nextChar,
      );
      await sleep(delay);
    }
  }

  /**
   * Get a random point within the viewport.
   */
  public async randomPagePoint(): Promise<{ x: number; y: number }> {
    try {
      const viewport = await this.evaluate(() => ({
        width: window.innerWidth,
        height: window.innerHeight,
      }));
      return {
        x: rand(50, viewport.width - 50),
        y: rand(50, viewport.height - 50),
      };
    } catch {
      // Fallback to default viewport size if evaluation fails
      return {
        x: rand(50, 1280 - 50),
        y: rand(50, 720 - 50),
      };
    }
  }

  /**
   * Move cursor to a random point on the page.
   */
  public async moveToRandomPagePoint(): Promise<void> {
    try {
      const point = await this.randomPagePoint();
      await this.stealthMoveTo(point.x, point.y);
    } catch (error) {
      // Silently fail - not critical if we can't move to a random point during init
    }
  }

  /**
   * Get a random point within a bounding box with padding.
   * @param quad - DOM.Quad array [x1,y1,x2,y2,x3,y3,x4,y4]
   */
  public randomPointInBoundingBox(quad: number[]): { x: number; y: number } {
    const [x1, y1, x2, y2, x3, y3, x4, y4] = quad as [
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
    ];

    const minX = Math.min(x1, x2, x3, x4);
    const maxX = Math.max(x1, x2, x3, x4);
    const minY = Math.min(y1, y2, y3, y4);
    const maxY = Math.max(y1, y2, y3, y4);

    const paddingX = (maxX - minX) * 0.1;
    const paddingY = (maxY - minY) * 0.1;

    return {
      x: rand(Math.ceil(minX + paddingX), Math.floor(maxX - paddingX)),
      y: rand(Math.ceil(minY + paddingY), Math.floor(maxY - paddingY)),
    };
  }

  public async addInitScript<Arg>(
    script: InitScriptSource<Arg>,
    arg?: Arg,
  ): Promise<void> {
    const source = await normalizeInitScriptSource(
      script,
      arg,
      "page.addInitScript",
    );
    await this.registerInitScript(source);
  }

  /**
   * Factory: create Page and seed registry with the shallow tree from Page.getFrameTree.
   * Assumes Page domain is already enabled on the session passed in.
   */
  static async create(
    conn: CdpConnection,
    session: CDPSessionLike,
    targetId: string,
    apiClient?: StagehandAPIClient | null,
    localBrowserLaunchOptions?: LocalBrowserLaunchOptions | null,
    browserIsRemote = false,
  ): Promise<Page> {
    await session.send("Page.enable").catch(() => {});
    await session
      .send("Page.setLifecycleEventsEnabled", { enabled: true })
      .catch(() => {});
    const { frameTree } = await session.send<{
      frameTree: Protocol.Page.FrameTree;
    }>("Page.getFrameTree");
    const mainFrameId = frameTree.frame.id;

    const page = new Page(
      conn,
      session,
      targetId,
      mainFrameId,
      apiClient,
      browserIsRemote,
    );
    // Seed current URL from initial frame tree
    try {
      page._currentUrl = String(frameTree?.frame?.url ?? page._currentUrl);
      if (localBrowserLaunchOptions?.viewport) {
        await page.setViewportSize(
          localBrowserLaunchOptions.viewport.width,
          localBrowserLaunchOptions.viewport.height,
          {
            deviceScaleFactor: localBrowserLaunchOptions.deviceScaleFactor ?? 1,
          },
        );
      }
    } catch {
      // ignore
    }

    // Seed topology + ownership for nodes known at creation time.
    page.registry.seedFromFrameTree(session.id ?? "root", frameTree);

    await page.initStealth();

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
      this.mainFrameWrapper = new Frame(
        this.mainSession,
        newRoot,
        this.pageId,
        this.browserIsRemote,
        this,
      );
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

    void this.applyInitScriptsToSession(childSession).catch(() => {});

    if (this.consoleListeners.size > 0) {
      this.installConsoleTap(childSession);
    }

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
    this.teardownConsoleTap(sessionId);
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
    const f = new Frame(sess, frameId, this.pageId, this.browserIsRemote, this);
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

  public on(event: "console", listener: ConsoleListener): Page {
    if (event !== "console") {
      throw new StagehandInvalidArgumentError(`Unsupported event: ${event}`);
    }

    const firstListener = this.consoleListeners.size === 0;
    this.consoleListeners.add(listener);

    if (firstListener) {
      this.ensureConsoleTaps();
    }

    return this;
  }

  public once(event: "console", listener: ConsoleListener): Page {
    if (event !== "console") {
      throw new StagehandInvalidArgumentError(`Unsupported event: ${event}`);
    }

    const wrapper: ConsoleListener = (message) => {
      this.off("console", wrapper);
      listener(message);
    };

    return this.on("console", wrapper);
  }

  public off(event: "console", listener: ConsoleListener): Page {
    if (event !== "console") {
      throw new StagehandInvalidArgumentError(`Unsupported event: ${event}`);
    }

    this.consoleListeners.delete(listener);

    if (this.consoleListeners.size === 0) {
      this.removeAllConsoleTaps();
    }

    return this;
  }

  // ---------------- MAIN APIs ----------------

  public targetId(): string {
    return this._targetId;
  }

  /**
   * Send a CDP command through the main session.
   * Allows external consumers to execute arbitrary Chrome DevTools Protocol commands.
   *
   * @param method - The CDP method name (e.g., "Page.enable", "Runtime.evaluate")
   * @param params - Optional parameters for the CDP command
   * @returns Promise resolving to the typed CDP response
   *
   * @example
   * // Enable the Runtime domain
   * await page.sendCDP("Runtime.enable");
   *
   * @example
   * // Evaluate JavaScript with typed response
   * const result = await page.sendCDP<Protocol.Runtime.EvaluateResponse>(
   *   "Runtime.evaluate",
   *   { expression: "1 + 1" }
   * );
   */
  public async sendCDP<T = unknown>(
    method: string,
    params?: object,
  ): Promise<T> {
    return this.mainSession.send<T>(method, params);
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
  @logAction("Page.close")
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
    this.removeAllConsoleTaps();
    this.consoleListeners.clear();
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

  private ensureConsoleTaps(): void {
    if (this.consoleListeners.size === 0) return;

    this.installConsoleTap(this.mainSession);
    for (const session of this.sessions.values()) {
      this.installConsoleTap(session);
    }
  }

  private installConsoleTap(session: CDPSessionLike): void {
    const key = this.sessionKey(session);
    if (this.consoleHandlers.has(key)) return;

    void session.send("Runtime.enable").catch(() => {});

    const handler = (evt: Protocol.Runtime.ConsoleAPICalledEvent) => {
      this.emitConsole(evt);
    };

    session.on<Protocol.Runtime.ConsoleAPICalledEvent>(
      "Runtime.consoleAPICalled",
      handler,
    );

    this.consoleHandlers.set(key, handler);
  }

  private sessionKey(session: CDPSessionLike): string {
    return session.id ?? "__root__";
  }

  private resolveSessionByKey(key: string): CDPSessionLike | undefined {
    if (this.mainSession.id) {
      if (this.mainSession.id === key) return this.mainSession;
    } else if (key === "__root__") {
      return this.mainSession;
    }

    return this.sessions.get(key);
  }

  private teardownConsoleTap(key: string): void {
    const handler = this.consoleHandlers.get(key);
    if (!handler) return;

    const session = this.resolveSessionByKey(key);
    session?.off("Runtime.consoleAPICalled", handler);
    this.consoleHandlers.delete(key);
  }

  private removeAllConsoleTaps(): void {
    for (const key of [...this.consoleHandlers.keys()]) {
      this.teardownConsoleTap(key);
    }
  }

  private emitConsole(evt: Protocol.Runtime.ConsoleAPICalledEvent): void {
    if (this.consoleListeners.size === 0) return;

    const message = new ConsoleMessage(evt, this);
    const listeners = [...this.consoleListeners];

    for (const listener of listeners) {
      try {
        listener(message);
      } catch (error) {
        v3Logger({
          category: "page",
          message: "Console listener threw",
          level: 2,
          auxiliary: {
            error: { value: String(error), type: "string" },
            type: { value: evt.type, type: "string" },
          },
        });
      }
    }
  }

  // -------- Convenience APIs delegated to the current main frame --------

  /**
   * Navigate the page; optionally wait for a lifecycle state.
   * Waits on the **current** main frame and follows root swaps during navigation.
   */
  @logAction("Page.goto")
  async goto(
    url: string,
    options?: { waitUntil?: LoadState; timeoutMs?: number },
  ): Promise<Response | null> {
    const waitUntil: LoadState = options?.waitUntil ?? "domcontentloaded";
    const timeout = options?.timeoutMs ?? 15000;

    const navigationCommandId = this.beginNavigationCommand();
    const tracker = new NavigationResponseTracker({
      page: this,
      session: this.mainSession,
      navigationCommandId,
    });

    const watcher = new LifecycleWatcher({
      page: this,
      mainSession: this.mainSession,
      networkManager: this.networkManager,
      waitUntil,
      timeoutMs: timeout,
      navigationCommandId,
    });

    try {
      // Route to API if available
      if (this.apiClient) {
        const result = await this.apiClient.goto(
          url,
          { waitUntil: options?.waitUntil },
          this.mainFrameId(),
        );
        this._currentUrl = url;

        if (isSerializableResponse(result)) {
          return Response.fromSerializable(result, {
            page: this,
            session: this.mainSession,
          });
        }
        return result;
      }
      const response =
        await this.mainSession.send<Protocol.Page.NavigateResponse>(
          "Page.navigate",
          { url },
        );
      this._currentUrl = url;
      if (response?.loaderId) {
        watcher.setExpectedLoaderId(response.loaderId);
        tracker.setExpectedLoaderId(response.loaderId);
      }
      await watcher.wait();
      return await tracker.navigationCompleted();
    } finally {
      watcher.dispose();
      tracker.dispose();
    }
  }

  /**
   * Reload the page; optionally wait for a lifecycle state.
   */
  @logAction("Page.reload")
  async reload(options?: {
    waitUntil?: LoadState;
    timeoutMs?: number;
    ignoreCache?: boolean;
  }): Promise<Response | null> {
    const waitUntil = options?.waitUntil;
    const timeout = options?.timeoutMs ?? 15000;

    const navigationCommandId = this.beginNavigationCommand();

    const tracker = new NavigationResponseTracker({
      page: this,
      session: this.mainSession,
      navigationCommandId,
    });
    tracker.expectNavigationWithoutKnownLoader();

    const watcher = waitUntil
      ? new LifecycleWatcher({
          page: this,
          mainSession: this.mainSession,
          networkManager: this.networkManager,
          waitUntil,
          timeoutMs: timeout,
          navigationCommandId,
        })
      : null;

    try {
      await this.mainSession.send("Page.reload", {
        ignoreCache: options?.ignoreCache ?? false,
      });

      if (watcher) {
        await watcher.wait();
      }
      return await tracker.navigationCompleted();
    } finally {
      watcher?.dispose();
      tracker.dispose();
    }
  }

  /**
   * Navigate back in history if possible; optionally wait for a lifecycle state.
   */
  @logAction("Page.goBack")
  async goBack(options?: {
    waitUntil?: LoadState;
    timeoutMs?: number;
  }): Promise<Response | null> {
    const { entries, currentIndex } =
      await this.mainSession.send<Protocol.Page.GetNavigationHistoryResponse>(
        "Page.getNavigationHistory",
      );
    const prev = entries[currentIndex - 1];
    if (!prev) return null; // nothing to do
    const waitUntil = options?.waitUntil;
    const timeout = options?.timeoutMs ?? 15000;

    const navigationCommandId = this.beginNavigationCommand();

    const tracker = new NavigationResponseTracker({
      page: this,
      session: this.mainSession,
      navigationCommandId,
    });
    tracker.expectNavigationWithoutKnownLoader();

    const watcher = waitUntil
      ? new LifecycleWatcher({
          page: this,
          mainSession: this.mainSession,
          networkManager: this.networkManager,
          waitUntil,
          timeoutMs: timeout,
          navigationCommandId,
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
      return await tracker.navigationCompleted();
    } finally {
      watcher?.dispose();
      tracker.dispose();
    }
  }

  /**
   * Navigate forward in history if possible; optionally wait for a lifecycle state.
   */
  @logAction("Page.goForward")
  async goForward(options?: {
    waitUntil?: LoadState;
    timeoutMs?: number;
  }): Promise<Response | null> {
    const { entries, currentIndex } =
      await this.mainSession.send<Protocol.Page.GetNavigationHistoryResponse>(
        "Page.getNavigationHistory",
      );
    const next = entries[currentIndex + 1];
    if (!next) return null; // nothing to do
    const waitUntil = options?.waitUntil;
    const timeout = options?.timeoutMs ?? 15000;

    const navigationCommandId = this.beginNavigationCommand();

    const tracker = new NavigationResponseTracker({
      page: this,
      session: this.mainSession,
      navigationCommandId,
    });
    tracker.expectNavigationWithoutKnownLoader();

    const watcher = waitUntil
      ? new LifecycleWatcher({
          page: this,
          mainSession: this.mainSession,
          networkManager: this.networkManager,
          waitUntil,
          timeoutMs: timeout,
          navigationCommandId,
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
      return await tracker.navigationCompleted();
    } finally {
      watcher?.dispose();
      tracker.dispose();
    }
  }

  /**
   * Return the current page URL (synchronous, cached from navigation events).
   */
  url(): string {
    return this._currentUrl;
  }

  private beginNavigationCommand(): number {
    const id = ++this.navigationCommandSeq;
    this.latestNavigationCommandId = id;
    return id;
  }

  public isCurrentNavigationCommand(id: number): boolean {
    return this.latestNavigationCommandId === id;
  }

  /**
   * Return the current page title.
   * Prefers reading from the active document via Runtime.evaluate to reflect dynamic changes.
   * Falls back to navigation history title if evaluation is unavailable.
   */
  async title(): Promise<string> {
    try {
      await this.mainSession.send("Runtime.enable").catch(() => {});
      const ctxId = await this.mainWorldExecutionContextId();
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
   * Capture a screenshot with Playwright-style options.
   *
   * @param options Optional screenshot configuration.
   * @param options.animations Control CSS/Web animations during capture. Use
   * "disabled" to fast-forward finite animations and pause infinite ones.
   * @param options.caret Either hide the text caret (default) or leave it
   * visible via "initial".
   * @param options.clip Restrict capture to a specific rectangle (in CSS
   * pixels). Cannot be combined with `fullPage`.
   * @param options.fullPage Capture the full scrollable page instead of the
   * current viewport.
   * @param options.mask Array of locators that should be covered with an
   * overlay while the screenshot is taken.
   * @param options.maskColor CSS color used for the mask overlay (default
   * `#FF00FF`).
   * @param options.omitBackground Make the default page background transparent
   * (PNG only).
   * @param options.path File path to write the screenshot to. The file extension
   * determines the image type when `type` is not explicitly provided.
   * @param options.quality JPEG quality (0–100). Only applies when
   * `type === "jpeg"`.
   * @param options.scale Render scale: use "css" for one pixel per CSS pixel,
   * otherwise the default "device" leverages the current device pixel ratio.
   * @param options.style Additional CSS text injected into every frame before
   * capture (removed afterwards).
   * @param options.timeout Maximum capture duration in milliseconds before a
   * timeout error is thrown.
   * @param options.type Image format (`"png"` by default).
   */
  @logAction("Page.screenshot")
  async screenshot(options?: ScreenshotOptions): Promise<Buffer> {
    const opts = options ?? {};
    const type = opts.type ?? "png";

    if (type !== "png" && type !== "jpeg") {
      throw new StagehandInvalidArgumentError(
        `screenshot: unsupported image type "${type}"`,
      );
    }

    if (opts.fullPage && opts.clip) {
      throw new StagehandInvalidArgumentError(
        "screenshot: clip and fullPage cannot be used together",
      );
    }

    if (type === "png" && typeof opts.quality === "number") {
      throw new StagehandInvalidArgumentError(
        'screenshot: quality option is only valid for type="jpeg"',
      );
    }

    const caretMode: ScreenshotCaretOption = opts.caret ?? "hide";
    const animationsMode: ScreenshotAnimationsOption =
      opts.animations ?? "allow";
    const scaleMode: ScreenshotScaleOption = opts.scale ?? "device";
    const frames = collectFramesForScreenshot(this);
    const clip = opts.clip ? normalizeScreenshotClip(opts.clip) : undefined;
    const captureScale = await computeScreenshotScale(this, scaleMode);
    const maskLocators = (opts.mask ?? []).filter(
      (locator): locator is Locator => Boolean(locator),
    );

    const cleanupTasks: ScreenshotCleanup[] = [];

    const exec = async (): Promise<Buffer> => {
      try {
        if (opts.omitBackground) {
          cleanupTasks.push(await setTransparentBackground(this.mainSession));
        }

        if (animationsMode === "disabled") {
          cleanupTasks.push(await disableAnimations(frames));
        }

        if (caretMode === "hide") {
          cleanupTasks.push(await hideCaret(frames));
        }

        if (opts.style && opts.style.trim()) {
          cleanupTasks.push(
            await applyStyleToFrames(frames, opts.style, "custom"),
          );
        }

        if (maskLocators.length > 0) {
          cleanupTasks.push(
            await applyMaskOverlays(maskLocators, opts.maskColor ?? "#FF00FF"),
          );
        }

        const buffer = await this.mainFrameWrapper.screenshot({
          fullPage: opts.fullPage,
          clip,
          type,
          quality: type === "jpeg" ? opts.quality : undefined,
          scale: captureScale,
        });

        if (opts.path) {
          await fs.writeFile(opts.path, buffer);
        }

        return buffer;
      } finally {
        await runScreenshotCleanups(cleanupTasks);
      }
    };

    return withScreenshotTimeout(opts.timeout, exec);
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
  @logAction("Page.waitForLoadState")
  async waitForLoadState(state: LoadState, timeoutMs?: number): Promise<void> {
    await this.waitForMainLoadState(state, timeoutMs ?? 15000);
  }

  /**
   * Wait for a specified amount of time.
   *
   * @param ms The number of milliseconds to wait.
   */
  async waitForTimeout(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Evaluate a function or expression in the current main frame's main world.
   * - If a string is provided, it is treated as a JS expression.
   * - If a function is provided, it is stringified and invoked with the optional argument.
   * - The return value should be JSON-serializable. Non-serializable objects will
   *   best-effort serialize via JSON.stringify inside the page context.
   */
  @logAction("Page.evaluate")
  async evaluate<R = unknown, Arg = unknown>(
    pageFunctionOrExpression: string | ((arg: Arg) => R | Promise<R>),
    arg?: Arg,
  ): Promise<R> {
    await this.mainSession.send("Runtime.enable").catch(() => {});
    const ctxId = await this.mainWorldExecutionContextId();

    const isString = typeof pageFunctionOrExpression === "string";
    let expression: string;

    if (isString) {
      expression = String(pageFunctionOrExpression);
    } else {
      const fnSrc = pageFunctionOrExpression.toString();
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
      throw new StagehandEvalError(msg);
    }

    return result?.value as R;
  }

  /**
   * Force the page viewport to an exact CSS size and device scale factor.
   * Ensures screenshots match width x height pixels when deviceScaleFactor = 1.
   */
  // @logAction("Page.setViewportSize")  // disabled because it's pretty noisy, can always re-enable if needed for debugging
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
  @logAction("Page.click")
  async click(
    x: number,
    y: number,
    options?: {
      button?: "left" | "right" | "middle";
      clickCount?: number;
      returnXpath?: boolean;
    },
  ): Promise<string> {
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

    // Stealth: Move to position with human-like trajectory
    await this.stealthMoveTo(x, y);

    // Stealth: Click with realistic timing
    for (let i = 1; i <= clickCount; i++) {
      await this.stealthClick(x, y, this.mainSession, button);
    }

    return xpathResult ?? "";
  }

  /**
   * Hover at absolute page coordinates (CSS pixels).
   * Dispatches mouseMoved via CDP Input domain on the top-level page target's
   * session.
   */
  @logAction("Page.hover")
  async hover(
    x: number,
    y: number,
    options?: { returnXpath?: boolean },
  ): Promise<string> {
    let xpathResult: string | undefined;
    if (options?.returnXpath) {
      try {
        const hit = await resolveXpathForLocation(this, x, y);
        if (hit) {
          v3Logger({
            category: "page",
            message: "hover resolved hit",
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
        }
      } catch {
        v3Logger({
          category: "page",
          message: "Failed to resolve xpath for hover",
          level: 2,
          auxiliary: {
            x: { value: String(x), type: "integer" },
            y: { value: String(y), type: "integer" },
          },
        });
      }
    }

    // Stealth: Move with human-like trajectory
    await this.stealthMoveTo(x, y);

    return xpathResult ?? "";
  }

  @logAction("Page.scroll")
  async scroll(
    x: number,
    y: number,
    deltaX: number,
    deltaY: number,
    options?: { returnXpath?: boolean },
  ): Promise<string> {
    let xpathResult: string | undefined;
    if (options?.returnXpath) {
      try {
        const hit = await resolveXpathForLocation(this, x, y);
        if (hit) xpathResult = hit.absoluteXPath;
      } catch {
        // best-effort
      }
    }

    // Stealth: Move with human-like trajectory
    await this.stealthMoveTo(x, y);

    // Dispatch mouse wheel event
    await this.mainSession.send<never>("Input.dispatchMouseEvent", {
      type: "mouseWheel",
      x,
      y,
      button: "none",
      deltaX,
      deltaY,
    } as Protocol.Input.DispatchMouseEventRequest);

    return xpathResult ?? "";
  }

  /**
   * Drag from (fromX, fromY) to (toX, toY) using mouse events.
   * Sends mouseMoved → mousePressed → mouseMoved (steps) → mouseReleased.
   */
  @logAction("Page.dragAndDrop")
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
  ): Promise<[string, string]> {
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

    // Move to start with stealth
    await this.stealthMoveTo(fromX, fromY);

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
      this.updateMouseCoordinates(x, y);
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
    this.updateMouseCoordinates(toX, toY);
    await this.mainSession.send<never>("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: toX,
      y: toY,
      button,
      buttons: buttonMask(button),
      clickCount: 1,
    } as Protocol.Input.DispatchMouseEventRequest);

    return [fromXpath ?? "", toXpath ?? ""];
  }

  /**
   * Type a string by dispatching keyDown/keyUp events per character.
   * Focus must already be on the desired element. Uses CDP Input.dispatchKeyEvent
   * and never falls back to Input.insertText. Optional delay applies between
   * successive characters.
   */
  @logAction("Page.type")
  async type(
    text: string,
    options?: { withMistakes?: boolean },
  ): Promise<void> {
    const withMistakes = !!options?.withMistakes;

    if (withMistakes) {
      // Handle typing with mistakes using stealth methods
      for (let i = 0; i < text.length; i++) {
        const ch = text[i]!;
        if (ch === "\n" || ch === "\r") {
          // Special handling for Enter key
          await this.keyPress("Enter");
        } else if (ch === "\t") {
          await this.keyPress("Tab");
        } else {
          // Random chance to make a mistake
          if (Math.random() < 0.12) {
            const pool = "abcdefghijklmnopqrstuvwxyz";
            const wrong = pool[Math.floor(Math.random() * pool.length)];
            await this.stealthTypeChar(wrong!);
            await sleep(
              rand(this._baseTypingDelayMin, this._baseTypingDelayMax),
            );
            await this.keyPress("Backspace");
            await sleep(
              rand(this._baseTypingDelayMin, this._baseTypingDelayMax),
            );
          }
          await this.stealthTypeChar(ch);
        }

        const nextChar = text[i + 1];
        const delay = computeDelayForChar(
          ch,
          this._baseTypingDelayMin,
          this._baseTypingDelayMax,
          nextChar,
        );
        await sleep(delay);
      }
    } else {
      // Normal stealth typing
      await this.stealthTypeValue(text);
    }
  }

  /**
   * Press a single key or key combination (keyDown then keyUp).
   * For printable characters, uses the text path on keyDown; for named keys, sets key/code/VK.
   * Supports key combinations with modifiers like "Cmd+A", "Ctrl+C", "Shift+Tab", etc.
   */
  @logAction("Page.keyPress")
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

  /** Normalize key names to match CDP expectations */
  private normalizeModifierKey(key: string): string {
    const lower = key.toLowerCase();
    switch (lower) {
      // Modifier keys
      case "cmd":
      case "command":
        // On Mac, Cmd is Meta; elsewhere map to Control for common shortcuts
        return this.isMacOS() ? "Meta" : "Control";
      case "win":
      case "windows":
        return "Meta";
      case "ctrl":
      case "control":
        return "Control";
      case "option":
      case "alt":
        return "Alt";
      case "shift":
        return "Shift";
      case "meta":
        return "Meta";
      // Action keys
      case "enter":
      case "return":
        return "Enter";
      case "esc":
      case "escape":
        return "Escape";
      case "backspace":
        return "Backspace";
      case "tab":
        return "Tab";
      case "space":
      case "spacebar":
        return " ";
      case "delete":
      case "del":
        return "Delete";
      // Arrow keys
      case "left":
      case "arrowleft":
        return "ArrowLeft";
      case "right":
      case "arrowright":
        return "ArrowRight";
      case "up":
      case "arrowup":
        return "ArrowUp";
      case "down":
      case "arrowdown":
        return "ArrowDown";
      // Navigation keys
      case "home":
        return "Home";
      case "end":
        return "End";
      case "pageup":
      case "pgup":
        return "PageUp";
      case "pagedown":
      case "pgdn":
        return "PageDown";
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

  /** Resolve the main-world execution context for the current main frame. */
  private async mainWorldExecutionContextId(): Promise<number> {
    return executionContexts.waitForMainWorld(
      this.mainSession,
      this.mainFrameId(),
      1000,
    );
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
      const ctxId = await this.mainWorldExecutionContextId();
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

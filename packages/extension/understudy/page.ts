import { Protocol } from "devtools-protocol";
import type { StagehandLogger } from "../logger.js";
import type { CDPSessionLike } from "./cdp.js";
import { CdpConnection } from "./cdp.js";
import { Frame } from "./frame.js";
import { FrameLocator } from "./frameLocator.js";
import { deepLocatorFromPage, resolveLocatorTarget } from "./deepLocator.js";
import { captureHybridSnapshot } from "./a11y/snapshot/index.js";
import { FrameRegistry } from "./frameRegistry.js";
import { executionContexts } from "./executionContextRegistry.js";
import {
  WebMCPInvocationDescriptorSchema,
  WebMCPInvokeOptionsSchema,
  WebMCPResultOptionsSchema,
  WebMCPToolDescriptorSchema,
  WebMCPToolResponseSchema,
  WebMCPToolsOptionsSchema,
  PageCDPEventSchema,
} from "@browserbasehq/stagehand-protocol/schemas";
import type {
  LoadState,
  LocalBrowserLaunchOptions,
  PageEventName,
  PageCDPEvent,
  PageSnapshotOptions,
  SnapshotResult,
  WebMCPAnnotation,
  WebMCPInvocationDescriptor,
  WebMCPInvokeOptions,
  WebMCPResultOptions,
  WebMCPToolDescriptor,
  WebMCPToolResponse,
  WebMCPToolsOptions,
} from "@browserbasehq/stagehand-protocol/types";
import type { HybridSnapshot, SnapshotOptions } from "../types/private/snapshot.js";
import { NetworkManager } from "./networkManager.js";
import { LifecycleWatcher } from "./lifecycleWatcher.js";
import { NavigationResponseTracker } from "./navigationResponseTracker.js";
import { Response } from "./response.js";
import { normalizeInitScriptSource } from "./initScripts.js";
import { buildLocatorInvocation } from "./locatorInvocation.js";
import type { UnderstudyScreenshotOptions } from "../types/private/screenshot.js";
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
  type ScreenshotCleanup,
} from "./screenshotUtils.js";
import { InitScriptSource } from "../types/private/index.js";
import { withTimeout } from "../timeoutConfig.js";

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

const MAX_WEBMCP_TOOLS_QUIET_WINDOW_MS = 100;
const WEBMCP_SETTLED_INVOCATION_RETENTION_MS = 5 * 60 * 1_000;

type PageCDPEventMethod = PageCDPEvent["method"];

export const PAGE_TO_CDP_EVENTS: Record<PageEventName, PageCDPEventMethod> = {
  ["console"]: "Runtime.consoleAPICalled",
};

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (error: Error) => void;
};

type WebMCPInvocationRecord = {
  descriptor: WebMCPInvocationDescriptor;
  session: CDPSessionLike;
  deferred: Deferred<WebMCPToolResponse>;
  result?: WebMCPToolResponse;
  retentionTimer?: ReturnType<typeof setTimeout>;
};

type WebMCPResponseSessionState = {
  handler: (event: Protocol.WebMCP.ToolRespondedEvent) => void;
  invocationIds: Set<string>;
  pendingCommands: number;
};

type CDPEventSubscription = {
  cdpEventMethod: PageCDPEventMethod;
  listener: (event: PageCDPEvent) => void;
  sessionHandlers: Map<string, { session: CDPSessionLike; handler: (params: unknown) => void }>;
};

function createDeferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>["resolve"];
  let reject!: Deferred<T>["reject"];
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  void promise.catch(() => {});
  return { promise, resolve, reject };
}

function webMCPAnnotation(annotation: Protocol.WebMCP.Annotation): WebMCPAnnotation {
  return {
    ...(annotation.readOnly === undefined ? {} : { readOnly: annotation.readOnly }),
    ...(annotation.untrustedContent === undefined
      ? {}
      : { untrustedContent: annotation.untrustedContent }),
    ...(annotation.autosubmit === undefined ? {} : { autosubmit: annotation.autosubmit }),
  };
}

function webMCPTool(tool: Protocol.WebMCP.Tool): WebMCPToolDescriptor {
  return WebMCPToolDescriptorSchema.parse({
    name: tool.name,
    description: tool.description,
    ...(tool.inputSchema === undefined
      ? {}
      : { inputSchema: tool.inputSchema as Record<string, unknown> }),
    ...(tool.annotations === undefined ? {} : { annotations: webMCPAnnotation(tool.annotations) }),
    frameId: tool.frameId,
    ...(tool.backendNodeId === undefined ? {} : { backendNodeId: tool.backendNodeId }),
  });
}

function webMCPToolResponse(event: Protocol.WebMCP.ToolRespondedEvent): WebMCPToolResponse {
  return WebMCPToolResponseSchema.parse({
    invocationId: event.invocationId,
    status: event.status,
    ...(event.output === undefined ? {} : { output: event.output }),
    ...(event.errorText === undefined ? {} : { errorText: event.errorText }),
    ...(event.exception === undefined ? {} : { exception: event.exception }),
  });
}

export class Page {
  /** Every CDP child session this page owns (top-level + adopted OOPIF sessions). */
  readonly sessions = new Map<string, CDPSessionLike>(); // sessionId -> session

  /** Unified truth for frame topology + ownership. */
  readonly registry: FrameRegistry;

  /** A convenience wrapper bound to the current main frame id (top-level session). */
  mainFrameWrapper: Frame;

  /** Compact ordinal per frameId (used by snapshot encoding). */
  frameOrdinals = new Map<string, number>();
  nextOrdinal = 0;

  /** cache Frames per frameId so everyone uses the same one */
  readonly frameCache = new Map<string, Frame>();
  readonly browserIsRemote: boolean;

  /** Stable id for Frames created by this Page (use top-level TargetId). */
  readonly pageId: string;
  /** Cached current URL for synchronous page.url() */
  _currentUrl: string = "about:blank";

  navigationCommandSeq = 0;
  latestNavigationCommandId = 0;

  readonly networkManager: NetworkManager;
  /** Document-start scripts installed across every session this page owns. */
  readonly initScripts: string[] = [];
  extraHTTPHeaders: Record<string, string> = {};
  private readonly webMCPInvocations = new Map<string, WebMCPInvocationRecord>();
  private readonly webMCPResponseSessions = new Map<CDPSessionLike, WebMCPResponseSessionState>();
  private readonly cdpEventSubscriptions = new Set<CDPEventSubscription>();

  private onWebMCPToolResponded(
    session: CDPSessionLike,
    event: Protocol.WebMCP.ToolRespondedEvent,
  ): void {
    const record = this.webMCPInvocations.get(event.invocationId);
    if (!record || record.session !== session || record.result !== undefined) return;

    const result = webMCPToolResponse(event);
    record.result = result;
    record.deferred.resolve(result);
    record.retentionTimer = setTimeout(() => {
      this.removeWebMCPInvocation(event.invocationId, record);
    }, WEBMCP_SETTLED_INVOCATION_RETENTION_MS);
  }

  constructor(
    readonly conn: CdpConnection,
    readonly mainSession: CDPSessionLike,
    readonly _targetId: string,
    mainFrameId: string,
    public readonly logger: StagehandLogger,
    browserIsRemote = false,
  ) {
    this.pageId = _targetId;
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
      this.logger,
    );

    this.networkManager = new NetworkManager();
    this.networkManager.trackSession(this.mainSession);
  }

  // Send a single init script to a specific CDP session.
  async installInitScriptOnSession(session: CDPSessionLike, source: string): Promise<void> {
    await session.send("Page.addScriptToEvaluateOnNewDocument", {
      source: source,
    });
  }

  // Replay every previously registered init script onto a newly adopted session.
  async applyInitScriptsToSession(session: CDPSessionLike): Promise<void> {
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

  // Seed an init script without re-installing it on the current sessions.
  public seedInitScript(source: string): void {
    if (this.initScripts.includes(source)) return;
    this.initScripts.push(source);
  }

  // --- Optional visual cursor overlay management ---
  cursorEnabled = false;
  async ensureCursorScript(): Promise<void> {
    await this.mainFrameWrapper
      .evaluateInLocatorWorld("globalThis.__stagehandLocatorScripts.installCursorOverlay()")
      .catch(() => {});
  }

  public async enableCursorOverlay(): Promise<void> {
    if (this.cursorEnabled) return;
    await this.ensureCursorScript();
    this.cursorEnabled = true;
  }

  async updateCursor(x: number, y: number): Promise<void> {
    if (!this.cursorEnabled) return;
    try {
      await this.mainFrameWrapper.evaluateInLocatorWorld(
        `globalThis.__stagehandLocatorScripts.moveCursorOverlay(${Math.round(x)}, ${Math.round(y)})`,
      );
    } catch {
      //
    }
  }

  public async addInitScript<Arg>(script: InitScriptSource<Arg>, arg?: Arg): Promise<void> {
    const source = await normalizeInitScriptSource(script, arg, "page.addInitScript");
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
    logger: StagehandLogger,
    localBrowserLaunchOptions?: LocalBrowserLaunchOptions | null,
    browserIsRemote = false,
  ): Promise<Page> {
    // Context already issues Page.enable + lifecycle enable before resume.
    // Re-issue here only as best-effort and do not block page registration on
    // their acknowledgements; some remote CDP backends can delay these replies
    // long after the target is otherwise ready.
    void session.send("Page.enable").catch(() => {});
    void session.send("Page.setLifecycleEventsEnabled", { enabled: true }).catch(() => {});
    const { frameTree } = await session.send<{
      frameTree: Protocol.Page.FrameTree;
    }>("Page.getFrameTree");
    const mainFrameId = frameTree.frame.id;

    const page = new Page(conn, session, targetId, mainFrameId, logger, browserIsRemote);
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

    return page;
  }

  // ---------------- Event-driven updates from Context ----------------

  /**
   * Parent/child session emitted a `frameAttached`.
   * Topology update + ownership stamped to **emitting session**.
   */
  public onFrameAttached(frameId: string, parentId: string | null, session: CDPSessionLike): void {
    this.ensureOrdinal(frameId);
    this.registry.onFrameAttached(frameId, parentId, session.id ?? "root");
    // Cache is keyed by frameId → invalidate to ensure future frameForId resolves with latest owner
    this.frameCache.delete(frameId);
  }

  /**
   * Parent/child session emitted a `frameDetached`.
   */
  public onFrameDetached(frameId: string, reason: string = "remove"): void {
    this.registry.onFrameDetached(frameId, reason);
    this.frameCache.delete(frameId);
  }

  /**
   * Parent/child session emitted a `frameNavigated`.
   * Topology + ownership update. Handles root swaps.
   */
  public onFrameNavigated(frame: Protocol.Page.Frame, session: CDPSessionLike): void {
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
        this.logger,
      );
    }

    // Update cached URL if this navigation pertains to the current main frame
    if (frame.id === this.mainFrameId()) {
      try {
        // Prefer frame.url; fallback keeps previous value
        this._currentUrl = String((frame as { url?: string })?.url ?? this._currentUrl);
      } catch {
        // ignore
      }
    }

    // Invalidate the cached Frame for this id (session may have changed)
    this.frameCache.delete(frame.id);
  }

  public onNavigatedWithinDocument(frameId: string, url: string, session: CDPSessionLike): void {
    const normalized = String(url ?? "").trim();
    if (!normalized) return;

    this.registry.onNavigatedWithinDocument(frameId, normalized, session.id ?? "root");

    if (frameId === this.mainFrameId()) {
      this._currentUrl = normalized;
    }
  }

  /**
   * An OOPIF child session whose **main** frame id equals the parent iframe’s frameId
   * has been attached; adopt the session into this Page and seed ownership for its subtree.
   */
  public adoptOopifSession(childSession: CDPSessionLike, childMainFrameId: string): void {
    if (childSession.id) this.sessions.set(childSession.id, childSession);

    for (const subscription of this.cdpEventSubscriptions) {
      this.attachCDPEventSubscription(subscription, childSession);
    }

    this.networkManager.trackSession(childSession);
    if (this.extraHTTPHeaders)
      void this.applyExtraHTTPHeadersToSession(childSession, this.extraHTTPHeaders).catch(() => {});

    void this.applyInitScriptsToSession(childSession).catch(() => {});

    // session will start emitting its own page events; mark ownership seed now
    this.registry.adoptChildSession(childSession.id ?? "child", childMainFrameId);
    this.frameCache.delete(childMainFrameId);

    // Bridge events from the child session to keep registry in sync
    childSession.on<Protocol.Page.FrameNavigatedEvent>("Page.frameNavigated", (evt) => {
      this.onFrameNavigated(evt.frame, childSession);
    });
    childSession.on<Protocol.Page.FrameAttachedEvent>("Page.frameAttached", (evt) => {
      this.onFrameAttached(evt.frameId, evt.parentFrameId ?? null, childSession);
    });
    childSession.on<Protocol.Page.FrameDetachedEvent>("Page.frameDetached", (evt) => {
      this.onFrameDetached(evt.frameId, evt.reason ?? "remove");
    });

    // One-shot seed the child's subtree ownership from its current tree
    void (async () => {
      try {
        await childSession.send("Page.enable").catch(() => {});
        let { frameTree } =
          await childSession.send<Protocol.Page.GetFrameTreeResponse>("Page.getFrameTree");

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
    const session = this.sessions.get(sessionId);
    if (session) {
      this.teardownWebMCPInvocationsForSession(
        session,
        (invocationId) =>
          `WebMCP invocation "${invocationId}" was disposed before it completed because its ` +
          `frame detached from page "${this.pageId}".`,
      );
    }
    for (const subscription of this.cdpEventSubscriptions) {
      this.detachCDPEventSubscription(subscription, sessionId);
    }
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
    const f = new Frame(sess, frameId, this.pageId, this.browserIsRemote, this.logger);
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

  sendInternalCDP<T = unknown>(method: string, params?: object): Promise<T> {
    return this.mainSession.send<T>(method, params);
  }

  /** Subscribe to events on every session owned by this page. */
  public subscribeCDPEvent(
    pageEventName: PageEventName,
    listener: (event: PageCDPEvent) => void,
  ): () => void {
    const cdpEventMethod = PAGE_TO_CDP_EVENTS[pageEventName];
    const subscription: CDPEventSubscription = {
      cdpEventMethod,
      listener,
      sessionHandlers: new Map(),
    };
    this.cdpEventSubscriptions.add(subscription);
    for (const session of this.sessions.values()) {
      this.attachCDPEventSubscription(subscription, session);
    }

    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.cdpEventSubscriptions.delete(subscription);
      for (const sessionId of subscription.sessionHandlers.keys()) {
        this.detachCDPEventSubscription(subscription, sessionId);
      }
    };
  }

  private attachCDPEventSubscription(
    subscription: CDPEventSubscription,
    session: CDPSessionLike,
  ): void {
    const sessionId = session.id ?? "root";
    if (subscription.sessionHandlers.has(sessionId)) return;
    const handler = (params: unknown): void => {
      const normalizedParams =
        params !== null && typeof params === "object" && !Array.isArray(params)
          ? (params as Record<string, unknown>)
          : {};
      const event = PageCDPEventSchema.parse({
        pageId: this.pageId,
        method: subscription.cdpEventMethod,
        params: normalizedParams,
        sessionId,
        targetId: this.conn.targetIdForSession(session.id) ?? this._targetId,
      });
      try {
        subscription.listener(event);
      } catch (error) {
        this.logger.error("Page CDP event listener failed", {
          category: "page",
          pageId: this.pageId,
          method: subscription.cdpEventMethod,
          sessionId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    };
    subscription.sessionHandlers.set(sessionId, { session, handler });
    session.on(subscription.cdpEventMethod, handler);
  }

  private detachCDPEventSubscription(subscription: CDPEventSubscription, sessionId: string): void {
    const registered = subscription.sessionHandlers.get(sessionId);
    if (!registered) return;
    registered.session.off(subscription.cdpEventMethod, registered.handler);
    subscription.sessionHandlers.delete(sessionId);
  }

  /**
   * Return a fresh snapshot of the WebMCP tools registered by the current page and its frames.
   *
   * Enabling the domain on each owned CDP session emits `toolsAdded` for every currently
   * registered tool in that target. Keep the listeners scoped to this call so tools from an
   * earlier document or call are never cached.
   */
  public async listWebMCPTools(
    options?: Partial<WebMCPToolsOptions>,
  ): Promise<WebMCPToolDescriptor[]> {
    const { timeout } = WebMCPToolsOptionsSchema.parse(options ?? {});
    const quietWindowMs = Math.min(MAX_WEBMCP_TOOLS_QUIET_WINDOW_MS, timeout);
    const tools = new Map<string, WebMCPToolDescriptor>();
    let toolsVersion = 0;
    let lastUpdatedAt: number | undefined;
    let scheduleQuietWindow: (() => void) | undefined;

    const toolKey = (tool: Pick<WebMCPToolDescriptor, "frameId" | "name">): string =>
      `${tool.frameId}\u0000${tool.name}`;

    const onToolsAdded = (event: Protocol.WebMCP.ToolsAddedEvent): void => {
      for (const tool of event.tools) {
        const normalized = webMCPTool(tool);
        tools.set(toolKey(normalized), normalized);
      }
      if (event.tools.length === 0) return;
      toolsVersion += 1;
      lastUpdatedAt = Date.now();
      scheduleQuietWindow?.();
    };

    const onToolsRemoved = (event: Protocol.WebMCP.ToolsRemovedEvent): void => {
      let changed = false;
      for (const tool of event.tools) {
        changed = tools.delete(toolKey(tool)) || changed;
      }
      if (!changed) return;
      toolsVersion += 1;
      lastUpdatedAt = Date.now();
      scheduleQuietWindow?.();
    };

    const deadline = Date.now() + timeout;
    const sessions = [
      this.mainSession,
      ...[...this.sessions.values()].filter((session) => session !== this.mainSession),
    ];
    for (const session of sessions) {
      session.on("WebMCP.toolsAdded", onToolsAdded);
      session.on("WebMCP.toolsRemoved", onToolsRemoved);
    }

    try {
      await Promise.all(sessions.map((session) => session.send("WebMCP.enable")));
      if (quietWindowMs === 0) return [...tools.values()];

      await new Promise<void>((resolve) => {
        const versionAfterEnable = toolsVersion;
        let quietTimer: ReturnType<typeof setTimeout> | undefined;
        let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
        let settled = false;

        const finish = (): void => {
          if (settled) return;
          settled = true;
          if (quietTimer !== undefined) clearTimeout(quietTimer);
          if (deadlineTimer !== undefined) clearTimeout(deadlineTimer);
          resolve();
        };

        scheduleQuietWindow = (): void => {
          if (settled) return;
          if (quietTimer !== undefined) clearTimeout(quietTimer);

          const now = Date.now();
          if (now >= deadline) {
            finish();
            return;
          }

          const updatedAfterEnable = toolsVersion > versionAfterEnable;
          const quietRemaining =
            updatedAfterEnable && lastUpdatedAt !== undefined
              ? Math.max(0, quietWindowMs - (now - lastUpdatedAt))
              : quietWindowMs;
          quietTimer = setTimeout(finish, Math.min(quietRemaining, deadline - now));
        };

        deadlineTimer = setTimeout(finish, Math.max(0, deadline - Date.now()));
        scheduleQuietWindow();
      });
    } finally {
      for (const session of sessions) {
        session.off("WebMCP.toolsAdded", onToolsAdded);
        session.off("WebMCP.toolsRemoved", onToolsRemoved);
      }
    }

    return [...tools.values()];
  }

  public async invokeWebMCPTool(
    frameId: string,
    toolName: string,
    options?: Partial<WebMCPInvokeOptions>,
  ): Promise<WebMCPInvocationDescriptor> {
    const { input } = WebMCPInvokeOptionsSchema.parse(options ?? {});
    const session = this.webMCPSessionForFrame(frameId);
    const responseState = this.ensureWebMCPResponseListener(session);
    responseState.pendingCommands += 1;

    let response: Protocol.WebMCP.InvokeToolResponse;
    try {
      response = await session.send<Protocol.WebMCP.InvokeToolResponse>("WebMCP.invokeTool", {
        frameId,
        toolName,
        input,
      });
    } catch (error) {
      responseState.pendingCommands -= 1;
      this.removeWebMCPResponseListenerIfIdle(session);
      throw error;
    }
    responseState.pendingCommands -= 1;
    if (this.webMCPResponseSessions.get(session) !== responseState) {
      throw new Error(
        `WebMCP session for frame "${frameId}" was disposed before invocation registration ` +
          `completed on page "${this.pageId}".`,
      );
    }

    if (this.webMCPInvocations.has(response.invocationId)) {
      this.removeWebMCPResponseListenerIfIdle(session);
      throw new Error(`WebMCP returned duplicate invocation ID "${response.invocationId}".`);
    }

    let descriptor: WebMCPInvocationDescriptor;
    try {
      descriptor = WebMCPInvocationDescriptorSchema.parse({
        invocationId: response.invocationId,
        toolName,
        frameId,
        input,
      });
    } catch (error) {
      this.removeWebMCPResponseListenerIfIdle(session);
      throw error;
    }
    this.webMCPInvocations.set(response.invocationId, {
      descriptor,
      session,
      deferred: createDeferred<WebMCPToolResponse>(),
    });
    responseState.invocationIds.add(response.invocationId);
    return descriptor;
  }

  public async waitForWebMCPInvocationResult(
    invocationId: string,
    options?: WebMCPResultOptions,
  ): Promise<WebMCPToolResponse> {
    const { timeout } = WebMCPResultOptionsSchema.parse(options ?? {});
    const record = this.webMCPInvocation(invocationId);
    if (timeout === undefined) return await record.deferred.promise;

    let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutTimer = setTimeout(() => {
        reject(
          new Error(
            `Timed out waiting for WebMCP tool "${record.descriptor.toolName}" invocation ` +
              `"${invocationId}" after ${timeout}ms.`,
          ),
        );
      }, timeout);
    });

    try {
      return await Promise.race([record.deferred.promise, timeoutPromise]);
    } finally {
      if (timeoutTimer !== undefined) clearTimeout(timeoutTimer);
    }
  }

  public async cancelWebMCPInvocation(invocationId: string): Promise<void> {
    const record = this.webMCPInvocation(invocationId);
    await record.session.send("WebMCP.cancelInvocation", { invocationId });
  }

  private webMCPSessionForFrame(frameId: string): CDPSessionLike {
    if (frameId === this.mainFrameId()) return this.mainSession;

    const sessionId = this.registry.getOwnerSessionId(frameId);
    const session = sessionId ? this.sessions.get(sessionId) : undefined;
    if (session) return session;

    throw new Error(
      `WebMCP frame "${frameId}" was not found on page "${this.pageId}" or has detached.`,
    );
  }

  private ensureWebMCPResponseListener(session: CDPSessionLike): WebMCPResponseSessionState {
    const existing = this.webMCPResponseSessions.get(session);
    if (existing) return existing;

    const state: WebMCPResponseSessionState = {
      handler: (event) => this.onWebMCPToolResponded(session, event),
      invocationIds: new Set<string>(),
      pendingCommands: 0,
    };
    session.on<Protocol.WebMCP.ToolRespondedEvent>("WebMCP.toolResponded", state.handler);
    this.webMCPResponseSessions.set(session, state);
    return state;
  }

  private removeWebMCPResponseListenerIfIdle(session: CDPSessionLike): void {
    const state = this.webMCPResponseSessions.get(session);
    if (!state || state.pendingCommands > 0 || state.invocationIds.size > 0) return;
    session.off<Protocol.WebMCP.ToolRespondedEvent>("WebMCP.toolResponded", state.handler);
    this.webMCPResponseSessions.delete(session);
  }

  private removeWebMCPInvocation(invocationId: string, record: WebMCPInvocationRecord): void {
    if (this.webMCPInvocations.get(invocationId) !== record) return;
    if (record.retentionTimer !== undefined) clearTimeout(record.retentionTimer);
    this.webMCPInvocations.delete(invocationId);
    this.webMCPResponseSessions.get(record.session)?.invocationIds.delete(invocationId);
    this.removeWebMCPResponseListenerIfIdle(record.session);
  }

  private webMCPInvocation(invocationId: string): WebMCPInvocationRecord {
    const record = this.webMCPInvocations.get(invocationId);
    if (record) return record;
    throw new Error(`WebMCP invocation "${invocationId}" was not found on page "${this.pageId}".`);
  }

  private teardownWebMCPInvocationsForSession(
    session: CDPSessionLike,
    errorMessage: (invocationId: string) => string,
  ): void {
    const responseState = this.webMCPResponseSessions.get(session);
    if (responseState) {
      session.off<Protocol.WebMCP.ToolRespondedEvent>(
        "WebMCP.toolResponded",
        responseState.handler,
      );
      this.webMCPResponseSessions.delete(session);
    }
    for (const [invocationId, record] of this.webMCPInvocations) {
      if (record.session !== session) continue;
      if (record.retentionTimer !== undefined) clearTimeout(record.retentionTimer);
      if (record.result === undefined) {
        record.deferred.reject(new Error(errorMessage(invocationId)));
      }
      this.webMCPInvocations.delete(invocationId);
    }
  }

  private teardownWebMCPInvocations(): void {
    for (const session of this.webMCPResponseSessions.keys()) {
      this.teardownWebMCPInvocationsForSession(
        session,
        (invocationId) =>
          `WebMCP invocation "${invocationId}" was disposed before it completed on page ` +
          `"${this.pageId}".`,
      );
    }
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

  /** Release page-scoped listeners, pending work, and network tracking. */
  public dispose(): void {
    for (const subscription of this.cdpEventSubscriptions) {
      this.cdpEventSubscriptions.delete(subscription);
      for (const sessionId of subscription.sessionHandlers.keys()) {
        this.detachCDPEventSubscription(subscription, sessionId);
      }
    }
    this.teardownWebMCPInvocations();
    this.networkManager.dispose();
  }

  /**
   * Close this top-level page (tab). Best-effort via Target.closeTarget.
   */
  public async close(): Promise<void> {
    this.teardownWebMCPInvocations();
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
          this.dispose();
          return;
        }
      } catch {
        // ignore and retry
      }
      await new Promise((r) => setTimeout(r, 25));
    }
    this.dispose();
  }

  public getFullFrameTree(): Protocol.Page.FrameTree {
    return this.asProtocolFrameTree(this.mainFrameId());
  }

  public asProtocolFrameTree(rootMainFrameId: string): Protocol.Page.FrameTree {
    return this.registry.asProtocolFrameTree(rootMainFrameId);
  }

  async applyExtraHTTPHeadersToSession(
    session: CDPSessionLike,
    headers: Record<string, string>,
  ): Promise<void> {
    await session.send("Network.enable");
    await session.send("Network.setExtraHTTPHeaders", {
      headers: headers,
    });
  }

  ensureOrdinal(frameId: string): number {
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
    options?: { waitUntil?: LoadState; timeout?: number },
  ): Promise<Response | null> {
    const waitUntil: LoadState = options?.waitUntil ?? "domcontentloaded";
    const timeout = options?.timeout ?? 15000;

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
      timeout,
      navigationCommandId,
    });

    try {
      const response = await this.mainSession.send<Protocol.Page.NavigateResponse>(
        "Page.navigate",
        { url },
      );
      this._currentUrl = url;
      if (response?.loaderId) {
        watcher.setExpectedLoaderId(response.loaderId);
        tracker.setExpectedLoaderId(response.loaderId);
      } else {
        tracker.expectNavigationWithoutKnownLoader();
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
  async reload(options?: {
    waitUntil?: LoadState;
    timeout?: number;
    ignoreCache?: boolean;
  }): Promise<Response | null> {
    const waitUntil: LoadState = options?.waitUntil ?? "domcontentloaded";
    const timeout = options?.timeout ?? 15000;

    const navigationCommandId = this.beginNavigationCommand();

    const tracker = new NavigationResponseTracker({
      page: this,
      session: this.mainSession,
      navigationCommandId,
    });
    tracker.expectNavigationWithoutKnownLoader();

    const watcher = new LifecycleWatcher({
      page: this,
      mainSession: this.mainSession,
      networkManager: this.networkManager,
      waitUntil,
      timeout,
      navigationCommandId,
    });

    try {
      await this.mainSession.send("Page.reload", {
        ignoreCache: options?.ignoreCache ?? false,
      });

      await watcher.wait();
      return await tracker.navigationCompleted();
    } finally {
      watcher.dispose();
      tracker.dispose();
    }
  }

  /**
   * Navigate back in history if possible; optionally wait for a lifecycle state.
   */
  async goBack(options?: { waitUntil?: LoadState; timeout?: number }): Promise<Response | null> {
    const { entries, currentIndex } =
      await this.mainSession.send<Protocol.Page.GetNavigationHistoryResponse>(
        "Page.getNavigationHistory",
      );
    const prev = entries[currentIndex - 1];
    if (!prev) return null; // nothing to do
    const waitUntil: LoadState = options?.waitUntil ?? "domcontentloaded";
    const timeout = options?.timeout ?? 15000;

    const navigationCommandId = this.beginNavigationCommand();

    const tracker = new NavigationResponseTracker({
      page: this,
      session: this.mainSession,
      navigationCommandId,
    });
    tracker.expectNavigationWithoutKnownLoader();

    const watcher = new LifecycleWatcher({
      page: this,
      mainSession: this.mainSession,
      networkManager: this.networkManager,
      waitUntil,
      timeout,
      navigationCommandId,
    });

    try {
      await this.mainSession.send("Page.navigateToHistoryEntry", {
        entryId: prev.id,
      });
      this._currentUrl = prev.url ?? this._currentUrl;

      await watcher.wait();
      return await tracker.navigationCompleted();
    } finally {
      watcher.dispose();
      tracker.dispose();
    }
  }

  /**
   * Navigate forward in history if possible; optionally wait for a lifecycle state.
   */
  async goForward(options?: { waitUntil?: LoadState; timeout?: number }): Promise<Response | null> {
    const { entries, currentIndex } =
      await this.mainSession.send<Protocol.Page.GetNavigationHistoryResponse>(
        "Page.getNavigationHistory",
      );
    const next = entries[currentIndex + 1];
    if (!next) return null; // nothing to do
    const waitUntil: LoadState = options?.waitUntil ?? "domcontentloaded";
    const timeout = options?.timeout ?? 15000;

    const navigationCommandId = this.beginNavigationCommand();

    const tracker = new NavigationResponseTracker({
      page: this,
      session: this.mainSession,
      navigationCommandId,
    });
    tracker.expectNavigationWithoutKnownLoader();

    const watcher = new LifecycleWatcher({
      page: this,
      mainSession: this.mainSession,
      networkManager: this.networkManager,
      waitUntil,
      timeout,
      navigationCommandId,
    });

    try {
      await this.mainSession.send("Page.navigateToHistoryEntry", {
        entryId: next.id,
      });
      this._currentUrl = next.url ?? this._currentUrl;

      await watcher.wait();
      return await tracker.navigationCompleted();
    } finally {
      watcher.dispose();
      tracker.dispose();
    }
  }

  /**
   * Return the current page URL (synchronous, cached from navigation events).
   */
  url(): string {
    return this._currentUrl;
  }

  beginNavigationCommand(): number {
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
      const { result } = await this.mainSession.send<Protocol.Runtime.EvaluateResponse>(
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
  async screenshot(options?: UnderstudyScreenshotOptions): Promise<Uint8Array> {
    const opts = options ?? {};
    const type = opts.type ?? "png";

    if (type !== "png" && type !== "jpeg") {
      throw new TypeError("screenshot: unsupported image type");
    }

    if (opts.fullPage && opts.clip) {
      throw new TypeError("screenshot: clip and fullPage cannot be used together");
    }

    if (type === "png" && typeof opts.quality === "number") {
      throw new TypeError('screenshot: quality option is only valid for type="jpeg"');
    }

    const caretMode: NonNullable<UnderstudyScreenshotOptions["caret"]> = opts.caret ?? "hide";
    const animationsMode: NonNullable<UnderstudyScreenshotOptions["animations"]> =
      opts.animations ?? "allow";
    const scaleMode: NonNullable<UnderstudyScreenshotOptions["scale"]> = opts.scale ?? "device";
    const frames = collectFramesForScreenshot(this);
    const clip = opts.clip ? normalizeScreenshotClip(opts.clip) : undefined;
    const captureScale = await computeScreenshotScale(this, scaleMode);
    const maskLocators = opts.mask ?? [];

    const cleanupTasks: ScreenshotCleanup[] = [];

    const exec = async (): Promise<Uint8Array> => {
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
          cleanupTasks.push(await applyStyleToFrames(frames, opts.style, "custom"));
        }

        if (maskLocators.length > 0) {
          cleanupTasks.push(await applyMaskOverlays(maskLocators, opts.maskColor ?? "#FF00FF"));
        }

        const buffer = await this.mainFrameWrapper.screenshot({
          fullPage: opts.fullPage,
          clip,
          type,
          quality: type === "jpeg" ? opts.quality : undefined,
          scale: captureScale,
        });

        return buffer;
      } finally {
        await runScreenshotCleanups(cleanupTasks);
      }
    };

    return await withTimeout(exec(), opts.timeout, "screenshot");
  }

  /**
   * specifies additional HTTP headers to be included in every request sent by
   * the root CDP session of the page, and all of its child CDP sessions.
   *
   * @param headers - the headers to be set.
   * Throws the first original CDP error when one or more sessions fail to enable
   * the Network domain or apply the headers.
   * @return void
   */
  async setExtraHTTPHeaders(headers: Record<string, string>): Promise<void> {
    const headersToSet = { ...headers };
    this.extraHTTPHeaders = headersToSet;

    // get the session(s) for this page:
    const sessions: CDPSessionLike[] = [this.mainSession];
    for (const session of this.sessions.values()) {
      if (session === this.mainSession) continue;
      sessions.push(session);
    }

    const results = await Promise.allSettled(
      sessions.map(async (session) => {
        await this.applyExtraHTTPHeadersToSession(session, headersToSet);
      }),
    );

    // get list of objects containing results & corresponding session IDs
    const pairs = results.map((result, index) => ({
      result,
      id: sessions[index].id,
    }));

    const filtered = pairs.filter(
      (pair): pair is { result: PromiseRejectedResult; id: string | null } =>
        pair.result.status === "rejected",
    );

    const failures = filtered.map((pair) => {
      const reason: unknown = pair.result.reason;
      const sessId = pair.id ?? "root";
      const message = reason instanceof Error ? reason.message : String(reason);
      return { reason, sessionId: sessId, message };
    });

    if (failures.length > 0) {
      this.logger.error("setExtraHTTPHeaders failed for one or more sessions", {
        category: "page",
        failures: failures.map(({ sessionId, message }) => ({ sessionId, message })),
      });
      throw failures[0]!.reason;
    }
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
  async waitForLoadState(state: LoadState, timeout?: number): Promise<void> {
    await this.waitForMainLoadState(state, timeout ?? 15000);
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
   * Wait for an element matching the selector to appear in the DOM.
   * Uses MutationObserver for efficiency
   * Pierces shadow DOM by default.
   * Supports iframe hop notation with '>>' (e.g., 'iframe#checkout >> .submit-btn').
   *
   * @param selector CSS selector to wait for (supports '>>' for iframe hops)
   * @param options
   * @param options.state Element state to wait for: 'attached' | 'detached' | 'visible' | 'hidden' (default: 'visible')
   * @param options.timeout Maximum time to wait in milliseconds (default: 30000)
   * @param options.pierceShadow Whether to search inside shadow DOM (default: true)
   * @returns True when the condition is met
   * @throws Error if timeout is reached before the condition is met
   */
  async waitForSelector(
    selector: string,
    options?: {
      state?: "attached" | "detached" | "visible" | "hidden";
      timeout?: number;
      pierceShadow?: boolean;
    },
  ): Promise<boolean> {
    const timeout = options?.timeout ?? 30000;
    const state = options?.state ?? "visible";
    const pierceShadow = options?.pierceShadow ?? true;
    const startTime = Date.now();
    const root = this.mainFrameWrapper;
    const { frame: targetFrame, selector: finalSelector } = await resolveLocatorTarget(
      this,
      root,
      selector,
    );
    const elapsed = Date.now() - startTime;
    const remainingTimeout = Math.max(0, timeout - elapsed);

    const expression = buildLocatorInvocation("waitForSelector", [
      JSON.stringify(finalSelector),
      JSON.stringify(state),
      String(remainingTimeout),
      String(pierceShadow),
    ]);
    return targetFrame.evaluateInLocatorWorld(expression);
  }

  /**
   * Evaluate a function or expression in the current main frame's main world.
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
      await this.mainSession.send<Protocol.Runtime.EvaluateResponse>("Runtime.evaluate", {
        expression,
        contextId: ctxId,
        returnByValue: true,
        awaitPromise: true,
      });

    if (exceptionDetails) {
      const msg =
        exceptionDetails.text || exceptionDetails.exception?.description || "Evaluation failed";
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
    await this.mainSession.send("Emulation.setVisibleSize", { width, height }).catch(() => {});
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
    },
  ): Promise<void> {
    const button = options?.button ?? "left";
    const clickCount = options?.clickCount ?? 1;

    // Synthesize a simple mouse move + press + release sequence.
    await this.updateCursor(x, y);
    // Dispatch click events in a pipelined burst to reduce inter-click delay
    // from network/CPU jitter between round trips.
    const dispatches: Array<Promise<unknown>> = [];
    dispatches.push(
      this.mainSession.send<never>("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x,
        y,
        button: "none",
      } as Protocol.Input.DispatchMouseEventRequest),
    );

    for (let i = 1; i <= clickCount; i++) {
      dispatches.push(
        this.mainSession.send<never>("Input.dispatchMouseEvent", {
          type: "mousePressed",
          x,
          y,
          button,
          clickCount: i,
        } as Protocol.Input.DispatchMouseEventRequest),
      );
      dispatches.push(
        this.mainSession.send<never>("Input.dispatchMouseEvent", {
          type: "mouseReleased",
          x,
          y,
          button,
          clickCount: i,
        } as Protocol.Input.DispatchMouseEventRequest),
      );
    }
    await Promise.all(dispatches);
  }

  /**
   * Hover at absolute page coordinates (CSS pixels).
   * Dispatches mouseMoved via CDP Input domain on the top-level page target's
   * session.
   */
  async hover(x: number, y: number): Promise<void> {
    await this.updateCursor(x, y);
    await this.mainSession.send<never>("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x,
      y,
      button: "none",
    } as Protocol.Input.DispatchMouseEventRequest);
  }
  async scroll(x: number, y: number, deltaX: number, deltaY: number): Promise<void> {
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
  }

  /**
   * Drag from (fromX, fromY) to (toX, toY) using mouse events.
   * Sends mouseMoved → mousePressed → mouseMoved (route or steps) → mouseReleased.
   */
  async dragAndDrop(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    options?: {
      button?: "left" | "right" | "middle";
      steps?: number;
      delay?: number;
      route?: Array<{ x: number; y: number }>;
    },
  ): Promise<void> {
    const button = options?.button ?? "left";
    const steps = Math.max(1, Math.floor(options?.steps ?? 1));
    const delay = Math.max(0, options?.delay ?? 0);

    const sleep = (ms: number) => new Promise<void>((r) => (ms > 0 ? setTimeout(r, ms) : r()));

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

    const samePoint = (point: { x: number; y: number }, x: number, y: number) =>
      point.x === x && point.y === y;
    const route = options?.route ?? [];
    let routeStart = 0;
    let routeEnd = route.length;
    while (routeStart < routeEnd && samePoint(route[routeStart], fromX, fromY)) routeStart++;
    while (routeEnd > routeStart && samePoint(route[routeEnd - 1], toX, toY)) routeEnd--;

    const movementPoints =
      route.length > 0
        ? [...route.slice(routeStart, routeEnd), { x: toX, y: toY }]
        : Array.from({ length: steps }, (_, index) => {
            const t = (index + 1) / steps;
            return {
              x: fromX + (toX - fromX) * t,
              y: fromY + (toY - fromY) * t,
            };
          });

    for (const { x, y } of movementPoints) {
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
  }

  /**
   * Type a string by dispatching keyDown/keyUp events per character.
   * Focus must already be on the desired element. Uses CDP Input.dispatchKeyEvent
   * and never falls back to Input.insertText. Optional delay applies between
   * successive characters.
   */
  async type(text: string, options?: { delay?: number; withMistakes?: boolean }): Promise<void> {
    const delay = Math.max(0, options?.delay ?? 0);
    const withMistakes = !!options?.withMistakes;

    const sleep = (ms: number) => new Promise<void>((r) => (ms > 0 ? setTimeout(r, ms) : r()));

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

      // Printable character: include key, code, and text for maximum compatibility
      // Some sites (like Wordle) check event.key rather than relying on text input
      const isLetter = /^[a-zA-Z]$/.test(ch);
      const isDigit = /^[0-9]$/.test(ch);

      let key = ch;
      let code = "";
      let windowsVirtualKeyCode: number | undefined;

      if (isLetter) {
        // For letters, key is the character, code is KeyX where X is uppercase
        key = ch;
        code = `Key${ch.toUpperCase()}`;
        windowsVirtualKeyCode = ch.toUpperCase().charCodeAt(0);
      } else if (isDigit) {
        key = ch;
        code = `Digit${ch}`;
        windowsVirtualKeyCode = ch.charCodeAt(0);
      } else if (ch === " ") {
        key = " ";
        code = "Space";
        windowsVirtualKeyCode = 32;
      }

      const down: Protocol.Input.DispatchKeyEventRequest = {
        type: "keyDown",
        key,
        code: code || undefined,
        text: ch,
        unmodifiedText: ch,
        windowsVirtualKeyCode,
      };
      await this.mainSession.send("Input.dispatchKeyEvent", down);
      await this.mainSession.send("Input.dispatchKeyEvent", {
        type: "keyUp",
        key,
        code: code || undefined,
        windowsVirtualKeyCode,
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
    const sleep = (ms: number) => new Promise<void>((r) => (ms > 0 ? setTimeout(r, ms) : r()));

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
  async captureSnapshot(options?: SnapshotOptions): Promise<HybridSnapshot> {
    return await captureHybridSnapshot(this, options, this.logger);
  }

  async snapshot(options?: PageSnapshotOptions): Promise<SnapshotResult> {
    const { combinedTree, combinedXpathMap, combinedUrlMap } = await this.captureSnapshot({
      pierceShadow: true,
      includeIframes: options?.includeIframes,
    });

    return {
      formattedTree: combinedTree,
      xpathMap: combinedXpathMap,
      urlMap: combinedUrlMap,
    };
  }

  // Track pressed modifier keys
  _pressedModifiers = new Set<string>();

  /** Press a key down without releasing it */
  async keyDown(key: string): Promise<void> {
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
        const macCommands = this.isMacOS() ? this.macCommandsFor(desc.code ?? "") : [];
        const req: Protocol.Input.DispatchKeyEventRequest = {
          type: "rawKeyDown",
          modifiers,
          key: desc.key,
          ...(desc.code ? { code: desc.code } : {}),
          ...(typeof desc.vk === "number" ? { windowsVirtualKeyCode: desc.vk } : {}),
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
  async keyUp(key: string): Promise<void> {
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
        windowsVirtualKeyCode: typeof desc.vk === "number" ? desc.vk : undefined,
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
  normalizeModifierKey(key: string): string {
    const lower = key.toLowerCase();
    switch (lower) {
      // Modifier keys
      case "cmd":
      case "command":
      case "controlormeta":
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
  getNamedKeys(): Record<
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
  describePrintableKey(ch: string): {
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

  isMacOS(): boolean {
    return /mac|iphone|ipad|ipod/iu.test(globalThis.navigator?.platform ?? "");
  }

  /**
   * Return Chromium mac editing commands (without trailing ':') for a given code like 'KeyA'
   * Only used on macOS to trigger system editing shortcuts (e.g., selectAll, copy, paste...).
   */
  macCommandsFor(code: string): string[] {
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
    return list.filter((c) => !c.startsWith("insert")).map((c) => c.substring(0, c.length - 1));
  }

  // ---- Page-level lifecycle waiter that follows main frame id swaps ----

  /** Resolve the main-world execution context for the current main frame. */
  async mainWorldExecutionContextId(): Promise<number> {
    return executionContexts.waitForMainWorld(this.mainSession, this.mainFrameId(), 1000);
  }

  async isMainLoadStateReady(state: "domcontentloaded" | "load"): Promise<boolean> {
    try {
      const ctxId = await this.mainWorldExecutionContextId();
      const { result } = await this.mainSession.send<Protocol.Runtime.EvaluateResponse>(
        "Runtime.evaluate",
        {
          expression: "document.readyState",
          contextId: ctxId,
          returnByValue: true,
        },
      );
      const readyState = String(result?.value ?? "");
      if (state === "domcontentloaded") {
        return readyState === "interactive" || readyState === "complete";
      }
      return readyState === "complete";
    } catch {
      return false;
    }
  }

  /**
   * Wait until the **current** main frame reaches a lifecycle state.
   * - Fast path via `document.readyState`.
   * - Event path listens at the session level and compares incoming `frameId`
   *   to `mainFrameId()` **at event time** to follow root swaps.
   */
  async waitForMainLoadState(state: LoadState, timeout = 15000): Promise<void> {
    await this.mainSession
      .send("Page.setLifecycleEventsEnabled", { enabled: true })
      .catch(() => {});

    // Fast path: check the *current* main frame's readyState.
    if (
      (state === "domcontentloaded" || state === "load") &&
      (await this.isMainLoadStateReady(state))
    ) {
      return;
    }

    const wanted = LIFECYCLE_NAME[state];
    return new Promise<void>((resolve, reject) => {
      let done = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      let pollTimer: ReturnType<typeof setTimeout> | null = null;
      let pollInFlight = false;

      const off = () => {
        this.mainSession.off("Page.lifecycleEvent", onLifecycle);
        this.mainSession.off("Page.domContentEventFired", onDomContent);
        this.mainSession.off("Page.loadEventFired", onLoad);
      };
      const clearPollTimer = () => {
        if (pollTimer) {
          clearTimeout(pollTimer);
          pollTimer = null;
        }
      };

      const finish = () => {
        if (done) return;
        done = true;
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        clearPollTimer();
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

      // Fallback polling closes lifecycle-event races in remote environments
      // where readyState has advanced but the corresponding event was missed.
      const pollReadyState = async () => {
        if (done || pollInFlight) return;
        pollInFlight = true;
        try {
          if (done) return;
          if (
            (state === "domcontentloaded" || state === "load") &&
            (await this.isMainLoadStateReady(state))
          ) {
            finish();
            return;
          }
        } finally {
          pollInFlight = false;
        }
        if (!done) {
          clearPollTimer();
          pollTimer = setTimeout(() => {
            void pollReadyState();
          }, 100);
        }
      };
      void pollReadyState();

      timer = setTimeout(() => {
        if (done) return;
        done = true;
        clearPollTimer();
        off();
        reject(new Error(`waitForMainLoadState(${state}) timed out after ${timeout}ms`));
      }, timeout);
    });
  }
}

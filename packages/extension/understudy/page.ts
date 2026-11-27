import { Protocol } from "devtools-protocol";
import type { StagehandLogger } from "../logger.js";
import type { CDPSessionLike } from "./cdp.js";
import { CdpConnection } from "./cdp.js";
import { evaluateWithShadowRoots } from "./shadowRootEvaluation.js";
import { Frame } from "./frame.js";
import { type Progress, runLocatorStep, runWithProgress } from "./progress.js";
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
  PageToolsAddedNotification,
  PageToolsRemovedNotification,
  WebMCPToolIdentity,
  PageSnapshotOptions,
  PagePDFOptions,
  PagePDFResult,
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
import { TimeoutError } from "../errors.js";
import { NetworkManager } from "./networkManager.js";
import type { SessionNetworkCapture } from "./sessionNetworkCapture.js";
import { LifecycleWatcher } from "./lifecycleWatcher.js";
import { NavigationResponseTracker } from "./navigationResponseTracker.js";
import { Response } from "./response.js";
import { normalizeInitScriptSource } from "./initScripts.js";
import { buildLocatorInvocation } from "./locatorInvocation.js";
import { waitForFunction, type FunctionWaitOptions } from "./functionWait.js";
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
  withScreenshotLock,
  type ScreenshotCleanup,
} from "./screenshotUtils.js";
import { InitScriptSource } from "../types/private/index.js";

const LIFECYCLE_NAME: Record<LoadState, string> = {
  load: "load",
  domcontentloaded: "DOMContentLoaded",
  networkidle: "networkIdle",
};

const MAX_WEBMCP_TOOLS_QUIET_WINDOW_MS = 100;
export type WebMCPToolsEvent =
  | Omit<PageToolsAddedNotification, "subscriptionId">
  | Omit<PageToolsRemovedNotification, "subscriptionId">;
type WebMCPToolsChange =
  | Pick<PageToolsAddedNotification, "event" | "tools">
  | Pick<PageToolsRemovedNotification, "event" | "tools">;
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

// Older Chrome versions omit the registration ID from tool events.
type CDPWebMCPTool<T extends { toolId: string }> = Omit<T, "toolId"> & { toolId?: string };

type WebMCPToolSessionState = {
  targetId?: string;
  ready: Deferred<void>;
  tools: Map<string, WebMCPToolDescriptor>;
  pendingTools: Map<string, WebMCPToolDescriptor>;
  added: (event: { tools: CDPWebMCPTool<Protocol.WebMCP.Tool>[] }) => void;
  removed: (event: { tools: CDPWebMCPTool<Protocol.WebMCP.RemovedTool>[] }) => void;
  error?: Error;
  enableFailed?: boolean;
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

function webMCPTool(tool: CDPWebMCPTool<Protocol.WebMCP.Tool>): WebMCPToolDescriptor {
  return WebMCPToolDescriptorSchema.parse({
    ...(tool.toolId === undefined ? {} : { toolId: tool.toolId }),
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

function webMCPToolKey(frameId: string, name: string): string {
  return `${frameId}\u0000${name}`;
}

function webMCPToolIdentity({ toolId, frameId, name }: WebMCPToolDescriptor): WebMCPToolIdentity {
  return { frameId, name, ...(toolId === undefined ? {} : { toolId }) };
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
  readonly sessions = new Map<string, CDPSessionLike>();

  readonly registry: FrameRegistry;

  mainFrameWrapper: Frame;

  frameOrdinals = new Map<string, number>();
  nextOrdinal = 0;

  readonly frameCache = new Map<string, Frame>();
  readonly browserIsRemote: boolean;

  readonly pageId: string;
  _currentUrl: string = "about:blank";

  navigationCommandSeq = 0;
  latestNavigationCommandId = 0;

  readonly networkManager: NetworkManager;
  readonly initScripts: string[] = [];
  /** Headers set with page.setExtraHTTPHeaders(). */
  extraHTTPHeaders: Record<string, string> = {};
  /** Headers set with context.setExtraHTTPHeaders(); the page's own headers win on a clash. */
  contextExtraHTTPHeaders: Record<string, string> = {};
  private readonly webMCPInvocations = new Map<string, WebMCPInvocationRecord>();
  private readonly webMCPResponseSessions = new Map<CDPSessionLike, WebMCPResponseSessionState>();
  private readonly webMCPToolSessions = new Map<CDPSessionLike, WebMCPToolSessionState>();
  private readonly webMCPToolsChanged = new Set<() => void>();
  private readonly webMCPToolEventListeners = new Set<(event: WebMCPToolsEvent) => void>();
  private disposed = false;
  private readonly cdpEventSubscriptions = new Set<CDPEventSubscription>();
  private readonly pageEventDisposers = new Set<() => void>();

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

    if (mainSession.id) this.sessions.set(mainSession.id, mainSession);

    this.registry = new FrameRegistry(_targetId, mainFrameId);

    this.mainFrameWrapper = new Frame(
      this.mainSession,
      mainFrameId,
      this.pageId,
      this.browserIsRemote,
      this.logger,
    );

    this.networkManager = new NetworkManager(this);
    this.networkManager.trackSession(this.mainSession);
  }

  async installInitScriptOnSession(session: CDPSessionLike, source: string): Promise<void> {
    await session.send("Page.addScriptToEvaluateOnNewDocument", {
      source: source,
    });
  }

  async applyInitScriptsToSession(session: CDPSessionLike): Promise<void> {
    for (const source of this.initScripts) {
      await this.installInitScriptOnSession(session, source);
    }
  }

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

  public seedInitScript(source: string): void {
    if (this.initScripts.includes(source)) return;
    this.initScripts.push(source);
  }

  cursorEnabled = false;
  async ensureCursorScript(): Promise<void> {
    await this.mainFrameWrapper
      .evaluateInLocatorWorld(() => "globalThis.__stagehandLocatorScripts.installCursorOverlay()")
      .catch(() => {});
  }

  public async enableCursorOverlay(): Promise<void> {
    if (this.cursorEnabled) return;
    await this.ensureCursorScript();
    this.cursorEnabled = true;
  }

  async updateCursor(x: number, y: number, progress?: Progress): Promise<void> {
    if (!this.cursorEnabled) return;
    try {
      await this.mainFrameWrapper.evaluateInLocatorWorld(
        () =>
          `globalThis.__stagehandLocatorScripts.moveCursorOverlay(${Math.round(x)}, ${Math.round(y)})`,
        progress,
      );
    } catch {
      progress?.throwIfStopped();
    }
  }

  public async addInitScript<Arg>(script: InitScriptSource<Arg>, arg?: Arg): Promise<void> {
    const source = await normalizeInitScriptSource(script, arg, "page.addInitScript");
    await this.registerInitScript(source);
  }

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
    } catch {}

    page.registry.seedFromFrameTree(session.id ?? "root", frameTree);

    void page.ensureWebMCPToolTracking(session).catch(() => {});

    return page;
  }

  public onFrameAttached(frameId: string, parentId: string | null, session: CDPSessionLike): void {
    this.ensureOrdinal(frameId);
    this.registry.onFrameAttached(frameId, parentId, session.id ?? "root");
    this.reconcilePendingWebMCPTools();
    this.frameCache.delete(frameId);
  }

  public onFrameDetached(frameId: string, reason: string = "remove"): void {
    if (reason !== "swap") this.invalidateWebMCPFrame(frameId);
    this.registry.onFrameDetached(frameId, reason);
    this.frameCache.delete(frameId);
  }

  public onFrameNavigated(frame: Protocol.Page.Frame, session: CDPSessionLike): void {
    const previous = this.registry.frames.get(frame.id);
    if (previous?.lastSeen?.loaderId !== frame.loaderId) {
      this.invalidateWebMCPFrame(
        frame.parentId ? frame.id : this.mainFrameId(),
        !!previous?.lastSeen?.loaderId,
      );
    }
    const prevRoot = this.mainFrameId();
    this.registry.onFrameNavigated(frame, session.id ?? "root");

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

    if (frame.id === this.mainFrameId()) {
      try {
        this._currentUrl = String((frame as { url?: string })?.url ?? this._currentUrl);
      } catch {}
    }

    this.frameCache.delete(frame.id);
    this.reconcilePendingWebMCPTools();
  }

  public onNavigatedWithinDocument(frameId: string, url: string, session: CDPSessionLike): void {
    const normalized = String(url ?? "").trim();
    if (!normalized) return;

    this.registry.onNavigatedWithinDocument(frameId, normalized, session.id ?? "root");
    this.reconcilePendingWebMCPTools();

    if (frameId === this.mainFrameId()) {
      this._currentUrl = normalized;
    }
  }

  public adoptOopifSession(
    childSession: CDPSessionLike,
    childMainFrameId: string,
    onFrameTreeSeeded?: () => void,
    networkCapture?: SessionNetworkCapture,
  ): void {
    if (this.disposed) {
      networkCapture?.dispose();
      return;
    }
    const previous = childSession.id ? this.sessions.get(childSession.id) : undefined;
    if (childSession.id) this.sessions.set(childSession.id, childSession);
    if (previous && previous !== childSession) this.stopWebMCPToolTracking(previous);

    for (const subscription of this.cdpEventSubscriptions) {
      this.attachCDPEventSubscription(subscription, childSession);
    }

    this.networkManager.trackSession(childSession, networkCapture, childMainFrameId);
    // The context already sent its headers before the child resumed. Only send when there
    // is something to add, since an empty set would erase the context's headers.
    const extraHTTPHeaders = this.mergedExtraHTTPHeaders();
    if (Object.keys(extraHTTPHeaders).length > 0)
      void this.applyExtraHTTPHeadersToSession(childSession, extraHTTPHeaders).catch(() => {});

    void this.applyInitScriptsToSession(childSession).catch(() => {});

    this.registry.adoptChildSession(childSession.id ?? "child", childMainFrameId);
    this.reconcilePendingWebMCPTools();
    this.frameCache.delete(childMainFrameId);

    childSession.on<Protocol.Page.FrameNavigatedEvent>("Page.frameNavigated", (evt) => {
      this.onFrameNavigated(evt.frame, childSession);
    });
    childSession.on<Protocol.Page.FrameDetachedEvent>("Page.frameDetached", (evt) => {
      this.onFrameDetached(evt.frameId, evt.reason ?? "remove");
    });

    const seedOwnership = (async () => {
      try {
        await childSession.send("Page.enable").catch(() => {});
        let { frameTree } =
          await childSession.send<Protocol.Page.GetFrameTreeResponse>("Page.getFrameTree");

        if (frameTree.frame.id !== childMainFrameId) {
          frameTree = {
            ...frameTree,
            frame: { ...frameTree.frame, id: childMainFrameId },
          };
        }

        if (!this.disposed && this.sessions.get(childSession.id ?? "") === childSession) {
          this.registry.seedFromFrameTree(childSession.id ?? "child", frameTree);
          this.reconcilePendingWebMCPTools();
          onFrameTreeSeeded?.();
        }
      } catch {}
    })();
    void this.ensureWebMCPToolTracking(childSession, seedOwnership).catch(() => {});
  }

  public detachOopifSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    this.sessions.delete(sessionId);
    if (session) {
      this.stopWebMCPToolTracking(session);
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
    for (const fid of this.registry.framesForSession(sessionId)) {
      this.registry.onFrameDetached(fid, "remove");
      this.frameCache.delete(fid);
    }
    this.networkManager.untrackSession(sessionId);
  }

  public getSessionForFrame(frameId: string): CDPSessionLike {
    const sid = this.registry.getOwnerSessionId(frameId);
    if (!sid) return this.mainSession;
    return this.sessions.get(sid) ?? this.mainSession;
  }

  public frameForId(frameId: string): Frame {
    const hit = this.frameCache.get(frameId);
    if (hit) return hit;

    const sess = this.getSessionForFrame(frameId);
    const f = new Frame(sess, frameId, this.pageId, this.browserIsRemote, this.logger);
    this.frameCache.set(frameId, f);
    return f;
  }

  public getSessionById(id: string): CDPSessionLike | undefined {
    return this.sessions.get(id);
  }

  public registerSessionForNetwork(session: CDPSessionLike): void {
    this.networkManager.trackSession(session);
  }

  public unregisterSessionForNetwork(sessionId: string | undefined): void {
    this.networkManager.untrackSession(sessionId);
  }

  public targetId(): string {
    return this._targetId;
  }

  sendInternalCDP<T = unknown>(method: string, params?: object): Promise<T> {
    return this.mainSession.send<T>(method, params);
  }

  public async subscribeCDPEvent(
    pageEventName: PageEventName,
    listener: (event: PageCDPEvent) => void,
    signal?: AbortSignal,
  ): Promise<() => void> {
    return this.subscribeWhenReady(
      undefined,
      () => this.attachCDPEventListener(pageEventName, listener),
      signal,
    );
  }

  public async subscribeResponse(
    listener: (response: Response) => void,
    signal?: AbortSignal,
  ): Promise<() => void> {
    return this.subscribeWhenReady(
      undefined,
      () => this.networkManager.subscribeResponse(listener),
      signal,
    );
  }

  public async subscribeWebMCPToolsChanged(
    listener: (event: WebMCPToolsEvent) => void,
    signal?: AbortSignal,
  ): Promise<() => void> {
    return this.subscribeWhenReady(
      () =>
        Promise.all(
          [...new Set([this.mainSession, ...this.sessions.values()])].map((session) =>
            this.ensureWebMCPToolTracking(session),
          ),
        ),
      () => {
        for (const [session, state] of this.webMCPToolSessions) {
          state.targetId ??= this.conn.targetIdForSession(session.id) ?? this._targetId;
        }
        const handler = (event: WebMCPToolsEvent) => {
          if (!this.webMCPToolEventListeners.has(handler)) return;
          try {
            listener(event);
          } catch (error) {
            this.logger.error("WebMCP state listener failed", {
              pageId: this.pageId,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        };
        this.webMCPToolEventListeners.add(handler);
        return () => {
          this.webMCPToolEventListeners.delete(handler);
        };
      },
      signal,
    );
  }

  private async subscribeWhenReady(
    ready: (() => Promise<unknown>) | undefined,
    activate: () => () => void,
    signal?: AbortSignal,
  ): Promise<() => void> {
    if (this.disposed) throw new Error("Page is disposed");
    signal?.throwIfAborted();
    const canceled = createDeferred<never>();
    let active = true;
    let disposeListener: (() => void) | undefined;
    const dispose = () => {
      if (!active) return;
      active = false;
      signal?.removeEventListener("abort", dispose);
      this.pageEventDisposers.delete(dispose);
      disposeListener?.();
      canceled.reject(new Error("Page event subscription was canceled"));
    };
    this.pageEventDisposers.add(dispose);
    signal?.addEventListener("abort", dispose, { once: true });
    try {
      if (ready) await Promise.race([ready(), canceled.promise]);
      if (!active) throw new Error("Page event subscription was canceled");
      disposeListener = activate();
      return dispose;
    } catch (error) {
      dispose();
      throw error;
    }
  }

  private attachCDPEventListener(
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
    let active = true;
    const dispose = () => {
      if (!active) return;
      active = false;
      this.cdpEventSubscriptions.delete(subscription);
      for (const sessionId of subscription.sessionHandlers.keys()) {
        this.detachCDPEventSubscription(subscription, sessionId);
      }
    };
    try {
      for (const session of this.sessions.values()) {
        this.attachCDPEventSubscription(subscription, session);
      }
      return dispose;
    } catch (error) {
      dispose();
      throw error;
    }
  }

  private attachCDPEventSubscription(
    subscription: CDPEventSubscription,
    session: CDPSessionLike,
  ): void {
    const sessionId = session.id ?? "root";
    if (subscription.sessionHandlers.has(sessionId)) return;
    const handler = (params: unknown): void => {
      if (
        !this.cdpEventSubscriptions.has(subscription) ||
        subscription.sessionHandlers.get(sessionId)?.handler !== handler
      )
        return;
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

  private notifyWebMCPToolsChanged(): void {
    for (const listener of this.webMCPToolsChanged) listener();
  }

  private emitWebMCPToolsChange(session: CDPSessionLike, change: WebMCPToolsChange): void {
    this.notifyWebMCPToolsChanged();
    if (this.disposed || !this.webMCPToolEventListeners.size || !change.tools.length) return;
    const state = this.webMCPToolSessions.get(session);
    const targetId = state?.targetId ?? this.conn.targetIdForSession(session.id) ?? this._targetId;
    if (state) state.targetId = targetId;
    const event: WebMCPToolsEvent = {
      ...change,
      pageId: this.pageId,
      sessionId: session.id ?? "root",
      targetId,
    };
    const listeners = [...this.webMCPToolEventListeners];
    for (const listener of listeners) listener(structuredClone(event));
  }

  private removeWebMCPTools(
    session: CDPSessionLike,
    state: WebMCPToolSessionState,
    matches: (tool: WebMCPToolDescriptor) => boolean = () => true,
    clearPending = true,
  ): void {
    if (clearPending) {
      for (const [key, tool] of state.pendingTools) {
        if (matches(tool)) state.pendingTools.delete(key);
      }
    }
    const tools: WebMCPToolIdentity[] = [];
    for (const [key, tool] of state.tools) {
      if (!matches(tool)) continue;
      state.tools.delete(key);
      tools.push(webMCPToolIdentity(tool));
    }
    if (tools.length) this.emitWebMCPToolsChange(session, { event: "toolsremoved", tools });
  }

  private ownsWebMCPFrame(session: CDPSessionLike, frameId: string): boolean {
    if (this.disposed) return false;
    if (frameId === this.mainFrameId()) return session === this.mainSession;
    return (
      this.registry.getOwnerSessionId(frameId) === (session.id ?? "root") &&
      (session === this.mainSession || this.sessions.get(session.id ?? "") === session)
    );
  }

  private publishWebMCPTools(
    session: CDPSessionLike,
    state: WebMCPToolSessionState,
    tools: WebMCPToolDescriptor[],
  ): void {
    const removed: WebMCPToolIdentity[] = [];
    const added: WebMCPToolDescriptor[] = [];
    for (const tool of tools) {
      const key = webMCPToolKey(tool.frameId, tool.name);
      const previous = state.tools.get(key);
      if (JSON.stringify(previous) === JSON.stringify(tool)) continue;
      if (previous && previous.toolId !== tool.toolId) {
        removed.push(webMCPToolIdentity(previous));
      }
      state.tools.set(key, tool);
      added.push(tool);
    }
    if (removed.length)
      this.emitWebMCPToolsChange(session, { event: "toolsremoved", tools: removed });
    if (added.length) this.emitWebMCPToolsChange(session, { event: "toolsadded", tools: added });
  }

  private reconcilePendingWebMCPTools(): void {
    for (const [session, state] of this.webMCPToolSessions) {
      if (state.error) continue;
      const owned: WebMCPToolDescriptor[] = [];
      for (const [key, tool] of state.pendingTools) {
        if (this.ownsWebMCPFrame(session, tool.frameId)) {
          state.pendingTools.delete(key);
          owned.push(tool);
        } else if (this.registry.getOwnerSessionId(tool.frameId)) {
          state.pendingTools.delete(key);
        }
      }
      this.publishWebMCPTools(session, state, owned);
    }
  }

  private ensureWebMCPToolTracking(
    session: CDPSessionLike,
    seedOwnership: Promise<void> = Promise.resolve(),
  ): Promise<void> {
    if (this.disposed) return Promise.reject(new Error("WebMCP page is disposed"));
    const existing = this.webMCPToolSessions.get(session);
    if (existing && !existing.enableFailed)
      return existing.error ? Promise.reject(existing.error) : existing.ready.promise;

    const state: WebMCPToolSessionState = {
      ready: createDeferred<void>(),
      tools: new Map(),
      pendingTools: new Map(),
      added: (event) => {
        if (this.webMCPToolSessions.get(session) !== state || state.error) return;
        try {
          const tools = event.tools.map(webMCPTool);
          const owned: WebMCPToolDescriptor[] = [];
          for (const tool of tools) {
            if (this.ownsWebMCPFrame(session, tool.frameId)) {
              owned.push(tool);
            } else if (!this.registry.getOwnerSessionId(tool.frameId)) {
              state.pendingTools.set(webMCPToolKey(tool.frameId, tool.name), tool);
            }
          }
          this.publishWebMCPTools(session, state, owned);
        } catch (error) {
          fail(error);
        }
      },
      removed: (event) => {
        if (this.webMCPToolSessions.get(session) !== state || state.error) return;
        const removed: WebMCPToolIdentity[] = [];
        for (const tool of event.tools) {
          const key = webMCPToolKey(tool.frameId, tool.name);
          const pending = state.pendingTools.get(key);
          if (pending && pending.toolId === tool.toolId) state.pendingTools.delete(key);
          const published = state.tools.get(key);
          if (published && published.toolId === tool.toolId) {
            state.tools.delete(key);
            removed.push(webMCPToolIdentity(published));
          }
        }
        if (removed.length)
          this.emitWebMCPToolsChange(session, { event: "toolsremoved", tools: removed });
      },
    };
    const fail = (error: unknown, enableFailed = false): void => {
      if (this.webMCPToolSessions.get(session) !== state || state.error) return;
      state.error = error instanceof Error ? error : new Error(String(error));
      state.enableFailed = enableFailed;
      this.removeWebMCPTools(session, state);
      session.off("WebMCP.toolsAdded", state.added);
      session.off("WebMCP.toolsRemoved", state.removed);
      state.ready.reject(state.error);
      this.notifyWebMCPToolsChanged();
      this.logger.error("WebMCP tracking failed", {
        pageId: this.pageId,
        sessionId: session.id ?? "root",
        targetId: this.targetId(),
        domain: "WebMCP",
        error: state.error.message,
      });
    };
    this.webMCPToolSessions.set(session, state);
    session.on("WebMCP.toolsAdded", state.added);
    session.on("WebMCP.toolsRemoved", state.removed);
    void seedOwnership
      .then(async () => {
        if (this.webMCPToolSessions.get(session) !== state) return;
        try {
          await session.send("WebMCP.enable");
        } catch (error) {
          fail(error, true);
        }
      })
      .then(() => {
        if (this.webMCPToolSessions.get(session) === state && !state.error) {
          state.ready.resolve();
          this.notifyWebMCPToolsChanged();
        }
      })
      .catch(fail);
    return state.ready.promise;
  }

  private stopWebMCPToolTracking(session: CDPSessionLike): void {
    const state = this.webMCPToolSessions.get(session);
    if (!state) return;
    session.off("WebMCP.toolsAdded", state.added);
    session.off("WebMCP.toolsRemoved", state.removed);
    this.removeWebMCPTools(session, state);
    this.webMCPToolSessions.delete(session);
    state.ready.reject(new Error("WebMCP session was detached or disposed"));
    this.notifyWebMCPToolsChanged();
  }

  private invalidateWebMCPFrame(frameId: string, clearPending = true): void {
    const frames = new Set<string>();
    const visit = (id: string): void => {
      if (frames.has(id)) return;
      frames.add(id);
      for (const child of this.registry.frames.get(id)?.children ?? []) visit(child);
    };
    visit(frameId);
    for (const [session, state] of this.webMCPToolSessions) {
      this.removeWebMCPTools(session, state, (tool) => frames.has(tool.frameId), clearPending);
    }
  }

  public async listWebMCPTools(
    options?: Partial<WebMCPToolsOptions>,
  ): Promise<WebMCPToolDescriptor[]> {
    const { timeout } = WebMCPToolsOptionsSchema.parse(options ?? {});
    const deadline = Date.now() + timeout;
    const ownedSessions = (): CDPSessionLike[] => [
      this.mainSession,
      ...[...this.sessions.values()].filter((session) => session !== this.mainSession),
    ];
    const ready = async (): Promise<void> => {
      await Promise.all(ownedSessions().map((session) => this.ensureWebMCPToolTracking(session)));
      if (this.disposed) throw new Error("WebMCP page is disposed");
      for (const state of this.webMCPToolSessions.values()) {
        if (state.error) throw state.error;
      }
    };
    await ready();
    if (timeout > 0 && Date.now() < deadline) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let changed!: () => void;
      try {
        await new Promise<void>((resolve) => {
          changed = () => {
            if (timer !== undefined) clearTimeout(timer);
            if (
              this.disposed ||
              [...this.webMCPToolSessions.values()].some((state) => state.error)
            ) {
              resolve();
              return;
            }
            timer = setTimeout(
              resolve,
              Math.max(0, Math.min(MAX_WEBMCP_TOOLS_QUIET_WINDOW_MS, deadline - Date.now())),
            );
          };
          this.webMCPToolsChanged.add(changed);
          changed();
        });
      } finally {
        this.webMCPToolsChanged.delete(changed);
        if (timer !== undefined) clearTimeout(timer);
      }
    }
    await ready();
    return ownedSessions().flatMap((session) =>
      [...(this.webMCPToolSessions.get(session)?.tools.values() ?? [])]
        .filter((tool) => this.ownsWebMCPFrame(session, tool.frameId))
        .map((tool) => structuredClone(tool)),
    );
  }

  public async invokeWebMCPTool(
    frameId: string,
    toolName: string,
    options?: Partial<WebMCPInvokeOptions> & Pick<WebMCPToolIdentity, "toolId">,
  ): Promise<WebMCPInvocationDescriptor> {
    const { toolId, ...invokeOptions } = options ?? {};
    const { input } = WebMCPInvokeOptionsSchema.parse(invokeOptions);
    const session = this.webMCPSessionForFrame(frameId);
    await this.ensureWebMCPToolTracking(session);
    if (this.disposed || !this.ownsWebMCPFrame(session, frameId)) {
      throw new Error(
        `WebMCP session for frame "${frameId}" was disposed before invocation registration completed.`,
      );
    }
    const selector = toolId === undefined ? { toolName } : { toolId };
    const responseState = this.ensureWebMCPResponseListener(session);
    responseState.pendingCommands += 1;

    let response: Protocol.WebMCP.InvokeToolResponse;
    try {
      response = await session.send<Protocol.WebMCP.InvokeToolResponse>("WebMCP.invokeTool", {
        frameId,
        ...selector,
        input,
      } satisfies Protocol.WebMCP.InvokeToolRequest);
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

  public seedCurrentUrl(url: string | undefined | null): void {
    if (!url) return;
    try {
      const normalized = String(url).trim();
      if (!normalized) return;
      this._currentUrl = normalized;
    } catch {}
  }

  public mainFrameId(): string {
    return this.registry.mainFrameId();
  }

  public mainFrame(): Frame {
    return this.mainFrameWrapper;
  }

  public dispose(): void {
    this.disposed = true;
    for (const dispose of this.pageEventDisposers) dispose();
    for (const session of this.webMCPToolSessions.keys()) this.stopWebMCPToolTracking(session);
    this.teardownWebMCPInvocations();
    this.networkManager.dispose();
  }

  public async close(): Promise<void> {
    this.teardownWebMCPInvocations();
    try {
      await this.conn.send("Target.closeTarget", { targetId: this._targetId });
    } catch {}
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      try {
        const targets = await this.conn.getTargets();
        if (!targets.some((t) => t.targetId === this._targetId)) {
          this.dispose();
          return;
        }
      } catch {}
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

  /**
   * The headers every session of this page sends: the context's headers with this page's
   * own headers on top. Network.setExtraHTTPHeaders replaces the whole set, so both layers
   * have to be sent together. Header names are case-insensitive, so a page header also
   * replaces a context header whose name differs only in case.
   */
  mergedExtraHTTPHeaders(): Record<string, string> {
    const pageHeaderNames = new Set(
      Object.keys(this.extraHTTPHeaders).map((name) => name.toLowerCase()),
    );
    const merged: Record<string, string> = {};
    for (const [name, value] of Object.entries(this.contextExtraHTTPHeaders)) {
      if (!pageHeaderNames.has(name.toLowerCase())) merged[name] = value;
    }
    return { ...merged, ...this.extraHTTPHeaders };
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

  public getOrdinal(frameId: string): number {
    return this.ensureOrdinal(frameId);
  }

  public listAllFrameIds(): string[] {
    return this.registry.listAllFrames();
  }

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

  async goBack(options?: { waitUntil?: LoadState; timeout?: number }): Promise<Response | null> {
    const { entries, currentIndex } =
      await this.mainSession.send<Protocol.Page.GetNavigationHistoryResponse>(
        "Page.getNavigationHistory",
      );
    const prev = entries[currentIndex - 1];
    if (!prev) return null;
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

  async goForward(options?: { waitUntil?: LoadState; timeout?: number }): Promise<Response | null> {
    const { entries, currentIndex } =
      await this.mainSession.send<Protocol.Page.GetNavigationHistoryResponse>(
        "Page.getNavigationHistory",
      );
    const next = entries[currentIndex + 1];
    if (!next) return null;
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

  async screenshot(
    options?: UnderstudyScreenshotOptions,
    parentProgress?: Progress,
  ): Promise<Uint8Array> {
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
    const maskLocators = opts.mask ?? [];

    const cleanupTasks: ScreenshotCleanup[] = [];

    let failure: { error: unknown } | undefined;
    const exec = async (progress: Progress): Promise<Uint8Array> => {
      try {
        const captureScale = await computeScreenshotScale(this, scaleMode, progress);
        if (opts.omitBackground) {
          await setTransparentBackground(this.mainSession, progress, cleanupTasks);
        }

        if (animationsMode === "disabled") {
          await disableAnimations(frames, progress, cleanupTasks);
        }

        if (caretMode === "hide") {
          await hideCaret(frames, progress, cleanupTasks);
        }

        if (opts.style && opts.style.trim()) {
          await applyStyleToFrames(frames, opts.style, "custom", progress, cleanupTasks);
        }

        if (maskLocators.length > 0) {
          await applyMaskOverlays(
            maskLocators,
            opts.maskColor ?? "#FF00FF",
            progress,
            cleanupTasks,
          );
        }

        return await withScreenshotLock(
          this.conn,
          () =>
            this.mainFrameWrapper.screenshot(
              {
                fullPage: opts.fullPage,
                clip,
                type,
                quality: type === "jpeg" ? opts.quality : undefined,
                scale: captureScale,
              },
              progress,
            ),
          progress,
        );
      } catch (error) {
        progress.throwIfStopped();
        failure = { error };
        throw error;
      } finally {
        await runScreenshotCleanups(cleanupTasks);
      }
    };

    try {
      return await runWithProgress(
        parentProgress ?? { name: "screenshot", timeout: opts.timeout ?? 0 },
        (progress) => withScreenshotLock(this, () => exec(progress), progress),
      );
    } catch (error) {
      throw failure ? failure.error : error;
    }
  }

  async pdf(options?: PagePDFOptions, parentProgress?: Progress): Promise<PagePDFResult> {
    const {
      timeout = 30_000,
      width,
      height,
      margin,
      tagged = false,
      outline = false,
      ...printOptions
    } = options ?? {};
    return await runWithProgress(parentProgress ?? { name: "pdf", timeout }, (progress) =>
      withScreenshotLock(
        this,
        async () => {
          const { data } = await this.mainSession.send<Protocol.Page.PrintToPDFResponse>(
            "Page.printToPDF",
            {
              ...printOptions,
              paperWidth: width,
              paperHeight: height,
              marginTop: margin?.top ?? 0,
              marginBottom: margin?.bottom ?? 0,
              marginLeft: margin?.left ?? 0,
              marginRight: margin?.right ?? 0,
              generateTaggedPDF: tagged,
              generateDocumentOutline: outline,
              transferMode: "ReturnAsBase64",
            },
          );
          return { data };
        },
        progress,
      ),
    );
  }

  async setExtraHTTPHeaders(headers: Record<string, string>): Promise<void> {
    this.extraHTTPHeaders = { ...headers };
    const headersToSet = this.mergedExtraHTTPHeaders();

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

  locator(selector: string): ReturnType<Frame["locator"]> {
    return this.mainFrameWrapper.locator(selector);
  }

  deepLocator(selector: string) {
    return deepLocatorFromPage(this, this.mainFrameWrapper, selector);
  }

  frameLocator(selector: string): FrameLocator {
    return new FrameLocator(this, selector);
  }

  frames(): Frame[] {
    const ids = this.listAllFrameIds();
    const withOrd = ids.map((id) => ({ id, ord: this.getOrdinal(id) }));
    withOrd.sort((a, b) => a.ord - b.ord);
    return withOrd.map(({ id }) => this.frameForId(id));
  }

  async waitForLoadState(state: LoadState, timeout = 15000): Promise<void> {
    if (state !== "networkidle") return this.waitForMainLoadState(state, timeout);

    await new LifecycleWatcher({
      page: this,
      mainSession: this.mainSession,
      networkManager: this.networkManager,
      waitUntil: state,
      timeout,
    }).wait();
  }

  async waitForTimeout(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async waitForFunction(expression: string, options?: FunctionWaitOptions): Promise<unknown> {
    return waitForFunction(
      () => {
        if (this.disposed) throw new Error("Page is disposed");
        if (!this.conn.connected) throw new Error("CDP connection closed: function wait stopped");
        return this.mainFrameWrapper;
      },
      expression,
      options,
    );
  }

  async waitForSelector(
    selector: string,
    options?: {
      state?: "attached" | "detached" | "visible" | "hidden";
      timeout?: number;
      pierceShadow?: boolean;
    },
    parentProgress?: Progress,
  ): Promise<boolean> {
    return runWithProgress(
      parentProgress ?? { name: "waitForSelector", timeout: options?.timeout ?? 30_000 },
      async (progress) => {
        const { frame: targetFrame, selector: finalSelector } = await resolveLocatorTarget(
          this,
          this.mainFrameWrapper,
          selector,
          progress,
        );
        return targetFrame.waitInLocatorWorld(() => {
          const remaining = progress.remainingMs();
          progress.throwIfStopped();
          return buildLocatorInvocation("createSelectorWait", [
            JSON.stringify(finalSelector),
            JSON.stringify(options?.state ?? "visible"),
            String(remaining === Infinity ? 0 : Math.ceil(remaining)),
            String(options?.pierceShadow ?? true),
          ]);
        }, progress);
      },
    );
  }

  async evaluateWithShadowRoots(functionSource: string): Promise<unknown> {
    return evaluateWithShadowRoots(
      this.mainSession,
      (expression) => this.evaluate(expression),
      functionSource,
    );
  }

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

    await this.mainSession.send("Emulation.setVisibleSize", { width, height }).catch(() => {});
  }

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

    await this.updateCursor(x, y);
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

  async hover(x: number, y: number): Promise<void> {
    await this.updateCursor(x, y);
    await this.mainSession.send<never>("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x,
      y,
      button: "none",
    } as Protocol.Input.DispatchMouseEventRequest);
  }
  async scroll(
    x: number,
    y: number,
    deltaX: number,
    deltaY: number,
    progress?: Progress,
  ): Promise<void> {
    await runLocatorStep(progress, "updating cursor", () => this.updateCursor(x, y, progress));
    await runLocatorStep(progress, "scrolling page", () =>
      this.mainSession.send<never>("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x,
        y,
        button: "none",
      } as Protocol.Input.DispatchMouseEventRequest),
    );

    await runLocatorStep(progress, "scrolling page", () =>
      this.mainSession.send<never>("Input.dispatchMouseEvent", {
        type: "mouseWheel",
        x,
        y,
        button: "none",
        deltaX,
        deltaY,
      } as Protocol.Input.DispatchMouseEventRequest),
    );
  }

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
    progress?: Progress,
  ): Promise<void> {
    const button = options?.button ?? "left";
    const steps = Math.max(1, Math.floor(options?.steps ?? 1));
    const delay = Math.max(0, options?.delay ?? 0);

    const sleep = (ms: number) =>
      progress ? progress.delay(ms) : new Promise<void>((r) => (ms > 0 ? setTimeout(r, ms) : r()));

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

    await runLocatorStep(progress, "updating cursor", () =>
      this.updateCursor(fromX, fromY, progress),
    );
    await runLocatorStep(progress, "dragging mouse", () =>
      this.mainSession.send<never>("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: fromX,
        y: fromY,
        button: "none",
      } as Protocol.Input.DispatchMouseEventRequest),
    );

    let pressed = false;
    let x = fromX;
    let y = fromY;
    const release = () =>
      this.mainSession.send<never>("Input.dispatchMouseEvent", {
        type: "mouseReleased",
        x,
        y,
        button,
        buttons: buttonMask(button),
        clickCount: 1,
      } as Protocol.Input.DispatchMouseEventRequest);
    try {
      progress?.throwIfStopped();
      await runLocatorStep(progress, "pressing mouse", () => {
        pressed = true;
        return this.mainSession.send<never>("Input.dispatchMouseEvent", {
          type: "mousePressed",
          x: fromX,
          y: fromY,
          button,
          buttons: buttonMask(button),
          clickCount: 1,
        } as Protocol.Input.DispatchMouseEventRequest);
      });

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

      for (const point of movementPoints) {
        progress?.throwIfStopped();
        await runLocatorStep(progress, "updating cursor", () =>
          this.updateCursor(point.x, point.y, progress),
        );
        await runLocatorStep(progress, "dragging mouse", () => {
          x = point.x;
          y = point.y;
          return this.mainSession.send<never>("Input.dispatchMouseEvent", {
            type: "mouseMoved",
            x,
            y,
            button,
            buttons: buttonMask(button),
          } as Protocol.Input.DispatchMouseEventRequest);
        });
        if (delay) await sleep(delay);
      }

      await runLocatorStep(progress, "updating cursor", () =>
        this.updateCursor(toX, toY, progress),
      );
      await runLocatorStep(progress, "releasing mouse", () => {
        pressed = false;
        return release();
      });
    } finally {
      if (pressed) {
        if (progress) await progress.cleanup(release);
        else await release().catch(() => {});
      }
    }
    progress?.throwIfStopped();
  }

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

  async keyPress(key: string, options?: { delay?: number }, progress?: Progress): Promise<void> {
    const delay = Math.max(0, options?.delay ?? 0);
    const sleep = (ms: number) =>
      progress ? progress.delay(ms) : new Promise<void>((r) => (ms > 0 ? setTimeout(r, ms) : r()));

    function split(keyString: string): string[] {
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

    const heldKeys = new Set<string>();
    try {
      for (const key of [...modifierKeys, mainKey]) {
        await runLocatorStep(progress, "pressing key", () => {
          heldKeys.add(key);
          return this.keyDown(key);
        });
      }
      if (delay) await sleep(delay);
      for (const key of [mainKey, ...modifierKeys.toReversed()]) {
        await runLocatorStep(progress, "releasing key", () => {
          heldKeys.delete(key);
          return this.keyUp(key);
        });
      }
    } catch (error) {
      if (progress) {
        await progress.cleanup(() =>
          Promise.allSettled([...heldKeys].reverse().map((key) => this.keyUp(key))),
        );
      }
      this._pressedModifiers.clear();
      throw error;
    }
  }
  async captureSnapshot(
    options?: SnapshotOptions,
    parentProgress?: Progress,
  ): Promise<HybridSnapshot> {
    return await runWithProgress(parentProgress ?? { name: "snapshot", timeout: 0 }, (progress) =>
      captureHybridSnapshot(this, options, progress, this.logger),
    );
  }

  async snapshot(
    options?: PageSnapshotOptions,
    parentProgress?: Progress,
  ): Promise<SnapshotResult> {
    return await runWithProgress(
      parentProgress ?? { name: "snapshot", timeout: options?.timeout ?? 20_000 },
      async (progress) => {
        const { combinedTree, combinedXpathMap, combinedUrlMap } = await this.captureSnapshot(
          { pierceShadow: true, includeIframes: options?.includeIframes },
          progress,
        );
        return { formattedTree: combinedTree, xpathMap: combinedXpathMap, urlMap: combinedUrlMap };
      },
    );
  }

  _pressedModifiers = new Set<string>();

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

    await this.mainSession.send("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: normalizedKey,
      modifiers,
    } as Protocol.Input.DispatchKeyEventRequest);
  }

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

    await this.mainSession.send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: normalizedKey,
      modifiers,
    } as Protocol.Input.DispatchKeyEventRequest);
  }

  normalizeModifierKey(key: string): string {
    const lower = key.toLowerCase();
    switch (lower) {
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
      Alt: { key: "Alt", code: "AltLeft", vk: 18 },
      Control: { key: "Control", code: "ControlLeft", vk: 17 },
      Meta: { key: "Meta", code: "MetaLeft", vk: 91 },
      Shift: { key: "Shift", code: "ShiftLeft", vk: 16 },
    };
  }

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
        vk: upper.charCodeAt(0),
      };
    }

    if (isDigit) {
      return {
        key: ch,
        code: `Digit${ch}`,
        vk: ch.charCodeAt(0),
      };
    }

    if (ch === " ") {
      return { key: " ", code: "Space", vk: 32 };
    }

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

  async waitForMainLoadState(state: LoadState, timeout = 15000): Promise<void> {
    await this.mainSession
      .send("Page.setLifecycleEventsEnabled", { enabled: true })
      .catch(() => {});

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
        reject(new TimeoutError(`waitForMainLoadState(${state})`, timeout));
      }, timeout);
    });
  }
}

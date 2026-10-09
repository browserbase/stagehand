import { DEFAULT_LOCATOR_TIMEOUT_MS } from "@browserbasehq/stagehand-protocol/schemas";
import { runWithProgress, type Progress } from "./understudy/progress.js";
import { ShadowRootEvaluationUnavailableError } from "./errors.js";
import type {
  ClearCookieOptions,
  ContextActivePageResult,
  ContextAddCookiesParams,
  ContextAddInitScriptParams,
  ContextClearCookiesParams,
  ContextClipboardClearParams,
  ContextClipboardCopyParams,
  ContextClipboardCutParams,
  ContextClipboardPasteParams,
  ContextClipboardReadTextParams,
  ContextClipboardReadTextResult,
  ContextClipboardWriteTextParams,
  ContextCookiesParams,
  ContextCookiesResult,
  ContextGetDomainPolicyResult,
  ContextNewPageParams,
  ContextPagesResult,
  ContextSetActivePageParams,
  ContextSetDomainPolicyParams,
  ContextSetExtraHTTPHeadersParams,
  ContextVoidResult,
  Cookie,
  CookieFilter,
  CookieParam,
  DomainPolicy,
  LLMGenerateParams,
  LLMGenerateResult,
  LoadState,
  LocatorClickParams,
  LocatorClickResult,
  LocatorCentroidResult,
  LocatorCountResult,
  LocatorDescriptor,
  LocatorParams,
  LocatorFillParams,
  LocatorFillResult,
  LocatorHighlightParams,
  LocatorHighlightResult,
  LocatorHoverResult,
  LocatorInnerHtmlResult,
  LocatorInnerTextResult,
  LocatorInputValueResult,
  LocatorIsCheckedResult,
  LocatorIsVisibleResult,
  LocatorScrollToParams,
  LocatorScrollToResult,
  LocatorSelectOptionParams,
  LocatorSelectOptionResult,
  LocatorSetInputFilesParams,
  LocatorSetInputFilesResult,
  LocatorSendClickEventParams,
  LocatorSendClickEventResult,
  LocatorTextContentResult,
  LocatorTypeParams,
  LocatorTypeResult,
  PageClickParams,
  PageCloseResult,
  PageCDPEvent,
  PageCDPEventNotification,
  PageEventNotification,
  PageEventName,
  PageAddInitScriptParams,
  PageDragAndDropParams,
  PageEvaluateParams,
  PageEvaluateResult,
  PageGoBackParams,
  PageGoForwardParams,
  PageGotoParams,
  PageHoverParams,
  PageIdParams,
  PageKeyPressParams,
  PageNavigationOptions,
  PageNavigationResult,
  PageOffParams,
  PageOnParams,
  PagePDFOptions,
  PagePDFParams,
  PagePDFResult,
  PageRef,
  PageReloadParams,
  PageScrollParams,
  PageScreenshotOptions,
  PageScreenshotParams,
  PageScreenshotResult,
  PageSetExtraHTTPHeadersParams,
  PageSetViewportSizeParams,
  PageSnapshotParams,
  PageSnapshotOptions,
  PageTitleResult,
  PageTypeParams,
  PageUrlResult,
  PageVoidResult,
  PageWaitForLoadStateParams,
  PageWaitForSelectorParams,
  PageWaitForSelectorResult,
  PageWaitForTimeoutParams,
  PageWebMCPCancelInvocationParams,
  PageWebMCPInvocationResultParams,
  PageWebMCPInvokeToolParams,
  PageWebMCPToolsParams,
  PageWebMCPToolsResult,
  ResponseAllHeadersResult,
  ResponseBodyResult,
  ResponseFinishedResult,
  ResponseHeadersArrayResult,
  ResponseIdParams,
  ResponseSecurityDetailsResult,
  ResponseServerAddrResult,
  StagehandInitParams,
  StagehandInitResult,
  SnapshotResult,
  WebMCPInvocationDescriptor,
  WebMCPInvokeOptions,
  WebMCPResultOptions,
  WebMCPToolDescriptor,
  WebMCPToolResponse,
  WebMCPToolsOptions,
} from "@browserbasehq/stagehand-protocol/types";
import { bytesToBase64 } from "./understudy/fileUploadUtils.js";
import { createStore } from "zustand/vanilla";
import type { StagehandLogEmitter } from "./logger.js";
import { StagehandLogger } from "./logger.js";
import { buildGatewayContext } from "./llm/gatewayClient.js";
import * as llmService from "./services/llmService.js";
import { StagehandRuntimeStateSchema, type StagehandRuntimeState } from "./runtimeState.js";
import { createStagehandTracing, type StagehandTracing } from "./tracing.js";
import type { HybridSnapshot, SnapshotOptions } from "./types/private/snapshot.js";
import type { SetInputFilesArgument } from "./types/private/fileUpload.js";
import { Page, type WebMCPToolsEvent } from "./understudy/page.js";
import { Response } from "./understudy/response.js";
import { StagehandMetricsAccumulator } from "./metrics.js";
import { ResponseHandleTable } from "./responseHandleTable.js";
import { BrowserSessionUnavailableError, DuplicatePageEventSubscriptionError } from "./errors.js";

export type UnderstudyRuntimePage = {
  targetId(): string;
  url(): string;
  goto(url: string, options?: PageNavigationOptions): Promise<unknown>;
  reload(options?: PageReloadParams["options"]): Promise<unknown>;
  goBack(options?: PageNavigationOptions): Promise<unknown>;
  goForward(options?: PageNavigationOptions): Promise<unknown>;
  click(x: number, y: number, options?: PageClickParams["options"]): Promise<void>;
  hover(x: number, y: number): Promise<void>;
  scroll(x: number, y: number, deltaX: number, deltaY: number): Promise<void>;
  dragAndDrop(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    options?: PageDragAndDropParams["options"],
  ): Promise<void>;
  type(text: string, options?: PageTypeParams["options"]): Promise<void>;
  keyPress(key: string, options?: PageKeyPressParams["options"]): Promise<void>;
  evaluate(expression: string): Promise<unknown>;
  evaluateWithShadowRoots?(functionSource: string): Promise<unknown>;
  addInitScript(source: string): Promise<void>;
  setExtraHTTPHeaders(headers: PageSetExtraHTTPHeadersParams["headers"]): Promise<void>;
  setViewportSize(
    width: number,
    height: number,
    options?: PageSetViewportSizeParams["options"],
  ): Promise<void>;
  waitForLoadState(state: LoadState, timeout?: number): Promise<void>;
  waitForTimeout(ms: number): Promise<void>;
  waitForSelector(
    selector: string,
    options?: PageWaitForSelectorParams["options"],
  ): Promise<boolean>;
  screenshot(options?: UnderstudyRuntimeScreenshotOptions): Promise<Uint8Array>;
  pdf(options?: PagePDFOptions): Promise<PagePDFResult>;
  snapshot(options?: PageSnapshotOptions): Promise<SnapshotResult>;
  listWebMCPTools(options?: Partial<WebMCPToolsOptions>): Promise<WebMCPToolDescriptor[]>;
  invokeWebMCPTool(
    frameId: string,
    toolName: string,
    options?: Partial<WebMCPInvokeOptions>,
  ): Promise<WebMCPInvocationDescriptor>;
  waitForWebMCPInvocationResult(
    invocationId: string,
    options?: WebMCPResultOptions,
  ): Promise<WebMCPToolResponse>;
  cancelWebMCPInvocation(invocationId: string): Promise<void>;
  title(): Promise<string>;
  close(): Promise<void> | void;
  captureSnapshot(options?: SnapshotOptions): Promise<HybridSnapshot>;
  deepLocator(selector: string): UnderstudyRuntimeLocator;
  subscribeCDPEvent(
    pageEventName: PageEventName,
    listener: (event: PageCDPEvent) => void,
    signal?: AbortSignal,
  ): Promise<() => void>;
  subscribeWebMCPToolsChanged(
    listener: (event: WebMCPToolsEvent) => void,
    signal?: AbortSignal,
  ): Promise<() => void>;
};

export type UnderstudyRuntimeScreenshotOptions = Omit<PageScreenshotOptions, "mask"> & {
  mask?: UnderstudyRuntimeLocator[];
};

export type UnderstudyRuntimeClearCookieOptions = {
  name?: string | RegExp;
  domain?: string | RegExp;
  path?: string | RegExp;
};

export type UnderstudyRuntimeClipboardOptions = {
  page?: UnderstudyRuntimePage;
};

export type UnderstudyRuntimeClipboardPasteOptions = UnderstudyRuntimeClipboardOptions & {
  shortcut?: ContextClipboardPasteParams["shortcut"];
};

export type UnderstudyRuntimeClipboard = {
  readText(options?: UnderstudyRuntimeClipboardOptions): Promise<string>;
  writeText(text: string, options?: UnderstudyRuntimeClipboardOptions): Promise<void>;
  clear(options?: UnderstudyRuntimeClipboardOptions): Promise<void>;
  paste(options?: UnderstudyRuntimeClipboardPasteOptions): Promise<void>;
  copy(options?: UnderstudyRuntimeClipboardOptions): Promise<void>;
  cut(options?: UnderstudyRuntimeClipboardOptions): Promise<void>;
};

export type UnderstudyRuntimeLocator = {
  click(options?: LocatorClickParams["options"], progress?: Progress): Promise<void> | void;
  hover(progress?: Progress): Promise<void> | void;
  fill(value: string, progress?: Progress): Promise<void> | void;
  count(progress?: Progress): Promise<number>;
  isChecked(progress?: Progress): Promise<boolean>;
  inputValue(progress?: Progress): Promise<string>;
  isVisible(progress?: Progress): Promise<boolean>;
  innerText(progress?: Progress): Promise<string>;
  innerHtml(progress?: Progress): Promise<string>;
  textContent(progress?: Progress): Promise<string>;
  scrollTo(percent: LocatorScrollToParams["percent"], progress?: Progress): Promise<void> | void;
  centroid(progress?: Progress): Promise<LocatorCentroidResult>;
  highlight(options?: LocatorHighlightParams["options"], progress?: Progress): Promise<void> | void;
  sendClickEvent(
    options?: LocatorSendClickEventParams["options"],
    progress?: Progress,
  ): Promise<void> | void;
  type(
    text: string,
    options?: LocatorTypeParams["options"],
    progress?: Progress,
  ): Promise<void> | void;
  selectOption(values: LocatorSelectOptionParams["values"], progress?: Progress): Promise<string[]>;
  setInputFiles(files: SetInputFilesArgument, progress?: Progress): Promise<void>;
  nth(index: number): UnderstudyRuntimeLocator;
};

export type StagehandBrowserSession = {
  readonly connected: boolean;
  prepareForInitialization?(): Promise<void>;
  pages(): UnderstudyRuntimePage[];
  newPage(url?: string): Promise<UnderstudyRuntimePage>;
  activePage(): Promise<UnderstudyRuntimePage | undefined>;
  setActivePage(page: UnderstudyRuntimePage): Promise<void>;
  addInitScript(source: string): Promise<void>;
  setExtraHTTPHeaders(headers: ContextSetExtraHTTPHeadersParams["headers"]): Promise<void>;
  getDomainPolicy(): DomainPolicy | null;
  setDomainPolicy(policy: DomainPolicy | null): Promise<void>;
  cookies(urls?: string | string[]): Promise<Cookie[]>;
  addCookies(cookies: CookieParam[]): Promise<void>;
  clearCookies(options?: UnderstudyRuntimeClearCookieOptions): Promise<void>;
  readonly clipboard: UnderstudyRuntimeClipboard;
  runWithTelemetryContext?<Result>(
    scope: symbol,
    logger: StagehandLogger,
    run: () => Result | Promise<Result>,
  ): Promise<Result>;
  close(): Promise<void> | void;
};

export type StagehandBrowserSessionLifecycle = {
  bootstrapMode?: "resident";
  onConnected?(): void;
  onDisconnected?(): void;
};

export type StagehandBrowserSessionOptions = {
  bootstrapLogger?: StagehandLogger;
  lifecycle?: StagehandBrowserSessionLifecycle;
};

export type StagehandBrowserSessionFactory = (
  cdpUrl: string,
  logger: StagehandLogger,
  options?: StagehandBrowserSessionOptions,
) => Promise<StagehandBrowserSession>;

export type StagehandRuntimeAdapters = {
  browserSessionFactory?: StagehandBrowserSessionFactory;
  emitLog?: StagehandLogEmitter;
  clientLLMGenerate?: (params: LLMGenerateParams) => Promise<LLMGenerateResult>;
  emitPageCDPEvent?: (notification: PageCDPEventNotification) => void;
  emitPageEvent?: (notification: PageEventNotification) => void;
};

type ResolvedStagehandRuntimeAdapters = Required<StagehandRuntimeAdapters>;

const defaultBrowserSessionFactory: StagehandBrowserSessionFactory = async () => {
  throw new Error("Stagehand browser session factory is not configured");
};
const discardLog: StagehandLogEmitter = () => {};
const discardPageCDPEvent = (): void => {};
const unavailableClientLLM = async (): Promise<never> => {
  throw new Error("The connected SDK did not register a client-side LLM");
};

/**
 * Covers the resident reconnect delay budget (100+250+500+1000+2000ms) plus one loopback proxy
 * discovery timeout (5s), so a client RPC rides out a normal reconnect instead of racing it.
 */
export const DEFAULT_BROWSER_SESSION_WAIT_MS = 10_000;

export function createStagehandRuntime(
  adapters: StagehandRuntimeAdapters = {},
  tracing: StagehandTracing = createStagehandTracing(),
): StagehandRuntime {
  return new StagehandRuntime(
    {
      browserSessionFactory: adapters.browserSessionFactory ?? defaultBrowserSessionFactory,
      emitLog: adapters.emitLog ?? discardLog,
      clientLLMGenerate: adapters.clientLLMGenerate ?? unavailableClientLLM,
      emitPageCDPEvent: adapters.emitPageCDPEvent ?? discardPageCDPEvent,
      emitPageEvent: adapters.emitPageEvent ?? discardPageCDPEvent,
    },
    tracing,
  );
}

type RuntimePageEventSubscription = {
  pageId: string;
  event: PageOnParams["event"];
  controller: AbortController;
  dispose?: () => void;
};

export class StagehandRuntime {
  readonly logger: StagehandLogger;
  readonly metrics = new StagehandMetricsAccumulator();
  readonly responseHandles = new ResponseHandleTable();
  readonly state = createStore<StagehandRuntimeState>()(() =>
    StagehandRuntimeStateSchema.parse({ status: "idle" }),
  );
  browserSession?: StagehandBrowserSession;
  pagesById = new Map<string, UnderstudyRuntimePage>();
  private readonly pageEventSubscriptions = new Map<string, RuntimePageEventSubscription>();
  private initializationInProgress = false;
  private lifecycleTail = Promise.resolve();
  private stagehandInstanceClosing = false;
  private activeStagehandInstanceRequests = 0;
  private stagehandInstanceRequestsDrained?: {
    promise: Promise<void>;
    resolve: () => void;
  };
  private stagehandInstanceDisposal?: Promise<void>;
  private readonly pendingPageEventResubscriptions = new Map<
    string,
    Pick<PageOnParams, "pageId" | "event">
  >();
  private browserSessionGeneration = 0;
  private browserSessionPending?: Promise<void>;
  private browserSessionRecovery?: () => Promise<void> | undefined;
  private readonly contextInitScripts: string[] = [];
  private contextExtraHTTPHeaders?: ContextSetExtraHTTPHeadersParams["headers"];
  private contextDomainPolicy?: DomainPolicy | null;
  private readonly pageInitScriptsById = new Map<string, string[]>();
  private readonly pageExtraHTTPHeadersById = new Map<
    string,
    PageSetExtraHTTPHeadersParams["headers"]
  >();
  private readonly pageViewportById = new Map<
    string,
    Pick<PageSetViewportSizeParams, "width" | "height" | "options">
  >();

  constructor(
    readonly adapters: ResolvedStagehandRuntimeAdapters,
    readonly tracing: StagehandTracing,
  ) {
    this.logger = new StagehandLogger(tracing, adapters.emitLog);
  }

  /**
   * Lets a lifecycle owner (the resident runtime) expose an in-flight or scheduled reconnect so
   * client RPCs can wait for it instead of observing the gap between two browser sessions.
   */
  setBrowserSessionRecoveryProvider(provider?: () => Promise<void> | undefined): void {
    this.browserSessionRecovery = provider;
  }

  browserConnectionStatus(): { configured: boolean; connected: boolean } {
    return {
      configured: this.browserSession !== undefined,
      connected: this.browserSession?.connected ?? false,
    };
  }

  async replaceBrowserConnection(
    params: { cdpUrl: string },
    options?: StagehandBrowserSessionOptions,
  ): Promise<void> {
    const replacement = this.runBrowserConnectionReplacement(params, options);
    // Waiters only need to know when the window closes; the outcome belongs to the caller.
    const pending = replacement.then(
      () => undefined,
      () => undefined,
    );
    this.browserSessionPending = pending;
    try {
      return await replacement;
    } finally {
      if (this.browserSessionPending === pending) this.browserSessionPending = undefined;
    }
  }

  /**
   * Resolves once no browser session replacement is in flight. Returns immediately when a connected
   * session is already available, so the ordinary RPC path pays nothing. A session that is merely
   * disconnected also waits, because the resident lifecycle schedules its reconnect before the
   * replacement that clears the field begins.
   */
  async waitForBrowserSession(timeoutMs = DEFAULT_BROWSER_SESSION_WAIT_MS): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let lastAwaited: Promise<void> | undefined;
    while (!this.browserSession?.connected) {
      const pending = this.browserSessionPending ?? this.browserSessionRecovery?.();
      // Nothing left to wait for: let requireBrowserSession report the real failure.
      if (!pending || pending === lastAwaited) return;
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) throw new BrowserSessionUnavailableError(timeoutMs);
      if (!(await settledWithin(pending, remainingMs))) {
        throw new BrowserSessionUnavailableError(timeoutMs);
      }
      lastAwaited = pending;
    }
  }

  private async runBrowserConnectionReplacement(
    params: { cdpUrl: string },
    options?: StagehandBrowserSessionOptions,
  ): Promise<void> {
    const { cdpUrl } = params;
    const generation = ++this.browserSessionGeneration;
    const previousSession = this.browserSession;
    this.browserSession = undefined;
    // Merge rather than replace: a reconnect superseded before it restored leaves the
    // active map empty, and the original subscriptions must survive until one succeeds.
    for (const [subscriptionId, { pageId, event }] of this.pageEventSubscriptions) {
      this.pendingPageEventResubscriptions.set(subscriptionId, { pageId, event });
    }
    this.disposeAllPageEventSubscriptions();
    this.pagesById.clear();
    this.responseHandles.clear();
    await previousSession?.close();

    let browserSession: StagehandBrowserSession | undefined;
    try {
      if (generation !== this.browserSessionGeneration) {
        throw new Error("Stagehand browser session bootstrap was superseded");
      }
      browserSession = await this.adapters.browserSessionFactory(cdpUrl, this.logger, options);
      if (generation !== this.browserSessionGeneration) {
        throw new Error("Stagehand browser session bootstrap was superseded");
      }
      this.browserSession = browserSession;
    } catch (error) {
      await browserSession?.close();
      if (generation === this.browserSessionGeneration) this.browserSession = undefined;
      throw error;
    }
  }

  async initialize(
    params: StagehandInitParams,
    logger: StagehandLogger = this.logger,
  ): Promise<StagehandInitResult> {
    if (this.initializationInProgress) {
      throw new Error("Stagehand initialization is already in progress");
    }
    this.initializationInProgress = true;

    try {
      return await this.enqueueLifecycle(async () => {
        const state = this.state.getState();
        if (state.status !== "idle") {
          throw new Error("A Stagehand instance is already initialized");
        }
        this.logger.setLevel(params.logLevel);
        if (!this.browserSession?.connected) {
          if (!params.browserCdpUrl) {
            throw new Error("stagehand.init requires browserCdpUrl until resident mode is active");
          }
          await this.replaceBrowserConnection(
            { cdpUrl: params.browserCdpUrl },
            { bootstrapLogger: logger },
          );
        }
        const pages = await this.runWithTelemetryContext(
          Symbol("stagehand.init"),
          logger,
          async () => {
            if (state.status === "idle") {
              await this.browserSession?.prepareForInitialization?.();
            }
            return await this.contextPages();
          },
        );
        await this.tracing.configure(params.telemetry, params.clientInfo);
        this.state.setState(
          StagehandRuntimeStateSchema.parse({
            status: "initialized",
            initParams: params,
          }),
          true,
        );

        return {
          initialized: true,
          pages,
        };
      });
    } finally {
      this.initializationInProgress = false;
    }
  }

  /** Restores initialization-dependent browser instrumentation after replacing a CDP session. */
  async restoreInitializedBrowserSession(): Promise<void> {
    if (this.state.getState().status !== "initialized") return;
    const session = this.requireBrowserSession();
    await session.prepareForInitialization?.();
    this.assertBrowserSessionCurrent(session);
    for (const source of this.contextInitScripts) {
      await session.addInitScript(source);
      this.assertBrowserSessionCurrent(session);
    }
    if (this.contextExtraHTTPHeaders) {
      await session.setExtraHTTPHeaders(this.contextExtraHTTPHeaders);
      this.assertBrowserSessionCurrent(session);
    }
    if (this.contextDomainPolicy !== undefined) {
      await session.setDomainPolicy(this.contextDomainPolicy);
      this.assertBrowserSessionCurrent(session);
    }
    await this.contextPages();
    this.assertBrowserSessionCurrent(session);
    // Pages that vanished while the connection was down never flowed through
    // refreshPageRegistry's prune, so drop their restore bookkeeping here.
    for (const pageId of new Set([
      ...this.pageInitScriptsById.keys(),
      ...this.pageExtraHTTPHeadersById.keys(),
      ...this.pageViewportById.keys(),
    ])) {
      if (!this.pagesById.has(pageId)) this.forgetPage(pageId);
    }
    for (const [pageId, page] of this.pagesById) {
      for (const source of this.pageInitScriptsById.get(pageId) ?? []) {
        await page.addInitScript(source);
        this.assertBrowserSessionCurrent(session);
      }
      const headers = this.pageExtraHTTPHeadersById.get(pageId);
      if (headers) {
        await page.setExtraHTTPHeaders(headers);
        this.assertBrowserSessionCurrent(session);
      }
      const viewport = this.pageViewportById.get(pageId);
      if (viewport) {
        await page.setViewportSize(viewport.width, viewport.height, viewport.options);
        this.assertBrowserSessionCurrent(session);
      }
    }
    for (const [subscriptionId, { pageId, event }] of this.pendingPageEventResubscriptions) {
      if (!this.pagesById.has(pageId)) {
        this.logger.warn(
          "Dropped page CDP event subscription for a page that did not survive the reconnect",
          { category: "resident", pageId, subscriptionId },
        );
        // There is intentionally no wire-level invalidation event: the page is gone,
        // so its next SDK use fails with the normal page-not-found error.
        continue;
      }
      if (this.pageEventSubscriptions.has(subscriptionId)) continue;
      try {
        await this.pageOn({ pageId, subscriptionId, event });
      } catch (error) {
        this.logger.warn("Failed to restore a page event subscription after reconnect", {
          category: "resident",
          pageId,
          subscriptionId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    this.assertBrowserSessionCurrent(session);
    this.pendingPageEventResubscriptions.clear();
  }

  private assertBrowserSessionCurrent(session: StagehandBrowserSession): void {
    if (this.browserSession !== session) {
      throw new Error("Stagehand browser session bootstrap was superseded");
    }
  }

  async runWithTelemetryContext<Result>(
    scope: symbol,
    logger: StagehandLogger,
    run: () => Result | Promise<Result>,
  ): Promise<Result> {
    const browserSession = this.browserSession;
    if (!browserSession?.runWithTelemetryContext) return await run();
    return await browserSession.runWithTelemetryContext(scope, logger, run);
  }

  async generateLlm(input: LLMGenerateParams): Promise<LLMGenerateResult> {
    const state = this.state.getState();
    const model = state.status === "initialized" ? state.initParams.model : undefined;
    const gateway =
      state.status === "initialized" ? buildGatewayContext(state.initParams) : undefined;
    if (!model && !gateway) {
      throw new Error("An LLM was not configured during Stagehand initialization");
    }
    return await llmService.generate(model, input, this.adapters.clientLLMGenerate, gateway);
  }

  async contextPages(): Promise<ContextPagesResult> {
    const pages = this.requireBrowserSession().pages();
    this.refreshPageRegistry(pages);
    return pages.map((page) => this.pageRefForId(page.targetId()));
  }

  async contextNewPage(params: ContextNewPageParams): Promise<PageRef> {
    const page = await this.requireBrowserSession().newPage(params.url);
    this.registerPage(page);
    return this.pageRefForId(page.targetId());
  }

  async contextActivePage(): Promise<ContextActivePageResult> {
    const page = await this.requireBrowserSession().activePage();
    if (!page) return null;
    this.registerPage(page);
    return pageRefFromUnderstudyPage(page);
  }

  async contextSetActivePage(params: ContextSetActivePageParams): Promise<ContextVoidResult> {
    const page = this.resolvePage(params.pageId);
    await this.requireBrowserSession().setActivePage(page);
    return { ok: true };
  }

  async contextAddInitScript(params: ContextAddInitScriptParams): Promise<ContextVoidResult> {
    await this.requireBrowserSession().addInitScript(params.source);
    if (!this.contextInitScripts.includes(params.source)) {
      this.contextInitScripts.push(params.source);
    }
    return { ok: true };
  }

  async contextSetExtraHTTPHeaders(
    params: ContextSetExtraHTTPHeadersParams,
  ): Promise<ContextVoidResult> {
    await this.requireBrowserSession().setExtraHTTPHeaders(params.headers);
    this.contextExtraHTTPHeaders = { ...params.headers };
    return { ok: true };
  }

  contextGetDomainPolicy(): ContextGetDomainPolicyResult {
    return this.requireBrowserSession().getDomainPolicy();
  }

  async contextSetDomainPolicy(params: ContextSetDomainPolicyParams): Promise<ContextVoidResult> {
    await this.requireBrowserSession().setDomainPolicy(params.policy);
    this.contextDomainPolicy = params.policy;
    return { ok: true };
  }

  async contextCookies(params: ContextCookiesParams): Promise<ContextCookiesResult> {
    return await this.requireBrowserSession().cookies(params.urls);
  }

  async contextAddCookies(params: ContextAddCookiesParams): Promise<ContextVoidResult> {
    await this.requireBrowserSession().addCookies(params.cookies);
    return { ok: true };
  }

  async contextClearCookies(params: ContextClearCookiesParams): Promise<ContextVoidResult> {
    await this.requireBrowserSession().clearCookies(hydrateClearCookieOptions(params.options));
    return { ok: true };
  }

  async contextClipboardReadText(
    params: ContextClipboardReadTextParams,
  ): Promise<ContextClipboardReadTextResult> {
    const clipboard = this.requireBrowserSession().clipboard;
    return await clipboard.readText(this.clipboardOptions(params.pageId));
  }

  async contextClipboardWriteText(
    params: ContextClipboardWriteTextParams,
  ): Promise<ContextVoidResult> {
    const clipboard = this.requireBrowserSession().clipboard;
    await clipboard.writeText(params.text, this.clipboardOptions(params.pageId));
    return { ok: true };
  }

  async contextClipboardClear(params: ContextClipboardClearParams): Promise<ContextVoidResult> {
    const clipboard = this.requireBrowserSession().clipboard;
    await clipboard.clear(this.clipboardOptions(params.pageId));
    return { ok: true };
  }

  async contextClipboardPaste(params: ContextClipboardPasteParams): Promise<ContextVoidResult> {
    const clipboard = this.requireBrowserSession().clipboard;
    const pageOptions = this.clipboardOptions(params.pageId);
    const options =
      pageOptions || params.shortcut !== undefined
        ? {
            ...pageOptions,
            ...(params.shortcut === undefined ? {} : { shortcut: params.shortcut }),
          }
        : undefined;
    await clipboard.paste(options);
    return { ok: true };
  }

  async contextClipboardCopy(params: ContextClipboardCopyParams): Promise<ContextVoidResult> {
    const clipboard = this.requireBrowserSession().clipboard;
    await clipboard.copy(this.clipboardOptions(params.pageId));
    return { ok: true };
  }

  async contextClipboardCut(params: ContextClipboardCutParams): Promise<ContextVoidResult> {
    const clipboard = this.requireBrowserSession().clipboard;
    await clipboard.cut(this.clipboardOptions(params.pageId));
    return { ok: true };
  }

  async pageGoto(params: PageGotoParams): Promise<PageNavigationResult> {
    const page = this.resolvePage(params.pageId);
    const response = await page.goto(params.url, params.options);
    return this.pageNavigationResult(params.pageId, page, response);
  }

  async pageReload(params: PageReloadParams): Promise<PageNavigationResult> {
    const page = this.resolvePage(params.pageId);
    const response = await page.reload(params.options);
    return this.pageNavigationResult(params.pageId, page, response);
  }

  async pageGoBack(params: PageGoBackParams): Promise<PageNavigationResult> {
    const page = this.resolvePage(params.pageId);
    const response = await page.goBack(params.options);
    return this.pageNavigationResult(params.pageId, page, response);
  }

  async pageGoForward(params: PageGoForwardParams): Promise<PageNavigationResult> {
    const page = this.resolvePage(params.pageId);
    const response = await page.goForward(params.options);
    return this.pageNavigationResult(params.pageId, page, response);
  }

  async responseBody(params: ResponseIdParams): Promise<ResponseBodyResult> {
    const body = await this.responseHandles.resolve(params.responseId).body();
    return { body: bytesToBase64(body), base64Encoded: true };
  }

  async responseAllHeaders(params: ResponseIdParams): Promise<ResponseAllHeadersResult> {
    return { headers: await this.responseHandles.resolve(params.responseId).allHeaders() };
  }

  async responseHeadersArray(params: ResponseIdParams): Promise<ResponseHeadersArrayResult> {
    return { headers: await this.responseHandles.resolve(params.responseId).headersArray() };
  }

  async responseSecurityDetails(params: ResponseIdParams): Promise<ResponseSecurityDetailsResult> {
    const details = await this.responseHandles.resolve(params.responseId).securityDetails();
    return {
      value:
        details === null
          ? null
          : {
              issuer: details.issuer,
              protocol: details.protocol,
              subjectName: details.subjectName,
              validFrom: details.validFrom,
              validTo: details.validTo,
            },
    };
  }

  async responseServerAddr(params: ResponseIdParams): Promise<ResponseServerAddrResult> {
    return { value: await this.responseHandles.resolve(params.responseId).serverAddr() };
  }

  async responseFinished(params: ResponseIdParams): Promise<ResponseFinishedResult> {
    const error = await this.responseHandles.resolve(params.responseId).finished();
    return { error: error === null ? null : { message: error.message } };
  }

  async pageClick(params: PageClickParams): Promise<PageVoidResult> {
    const { pageId, x, y, options } = params;
    await this.resolvePage(pageId).click(x, y, options);
    return { ok: true };
  }

  async pageHover(params: PageHoverParams): Promise<PageVoidResult> {
    const { pageId, x, y } = params;
    await this.resolvePage(pageId).hover(x, y);
    return { ok: true };
  }

  async pageScroll(params: PageScrollParams): Promise<PageVoidResult> {
    const { pageId, x, y, deltaX, deltaY } = params;
    await this.resolvePage(pageId).scroll(x, y, deltaX, deltaY);
    return { ok: true };
  }

  async pageDragAndDrop(params: PageDragAndDropParams): Promise<PageVoidResult> {
    const { pageId, fromX, fromY, toX, toY, options } = params;
    await this.resolvePage(pageId).dragAndDrop(fromX, fromY, toX, toY, options);
    return { ok: true };
  }

  async pageType(params: PageTypeParams): Promise<PageVoidResult> {
    await this.resolvePage(params.pageId).type(params.text, params.options);
    return { ok: true };
  }

  async pageKeyPress(params: PageKeyPressParams): Promise<PageVoidResult> {
    await this.resolvePage(params.pageId).keyPress(params.key, params.options);
    return { ok: true };
  }

  async evaluateWithShadowRoots(pageId: string, functionSource: string): Promise<unknown> {
    const page = this.resolvePage(pageId);
    this.logger.debug("page.evaluateWithShadowRoots", { pageId });
    if (!page.evaluateWithShadowRoots) throw new ShadowRootEvaluationUnavailableError();
    return page.evaluateWithShadowRoots(functionSource);
  }

  async pageEvaluate(params: PageEvaluateParams): Promise<PageEvaluateResult> {
    const value = await this.resolvePage(params.pageId).evaluate(params.expression);
    return {
      value: value === undefined ? null : (value as PageEvaluateResult["value"]),
    };
  }

  async pageAddInitScript(params: PageAddInitScriptParams): Promise<PageVoidResult> {
    await this.resolvePage(params.pageId).addInitScript(params.source);
    const sources = this.pageInitScriptsById.get(params.pageId) ?? [];
    if (!sources.includes(params.source)) sources.push(params.source);
    this.pageInitScriptsById.set(params.pageId, sources);
    return { ok: true };
  }

  async pageSetExtraHTTPHeaders(params: PageSetExtraHTTPHeadersParams): Promise<PageVoidResult> {
    await this.resolvePage(params.pageId).setExtraHTTPHeaders(params.headers);
    this.pageExtraHTTPHeadersById.set(params.pageId, { ...params.headers });
    return { ok: true };
  }

  async pageSetViewportSize(params: PageSetViewportSizeParams): Promise<PageVoidResult> {
    await this.resolvePage(params.pageId).setViewportSize(
      params.width,
      params.height,
      params.options,
    );
    this.pageViewportById.set(params.pageId, {
      width: params.width,
      height: params.height,
      ...(params.options === undefined ? {} : { options: { ...params.options } }),
    });
    return { ok: true };
  }

  async pageWaitForLoadState(params: PageWaitForLoadStateParams): Promise<PageVoidResult> {
    await this.resolvePage(params.pageId).waitForLoadState(params.state, params.timeout);
    return { ok: true };
  }

  async pageWaitForTimeout(params: PageWaitForTimeoutParams): Promise<PageVoidResult> {
    await this.resolvePage(params.pageId).waitForTimeout(params.ms);
    return { ok: true };
  }

  async pageWaitForSelector(params: PageWaitForSelectorParams): Promise<PageWaitForSelectorResult> {
    const matched = await this.resolvePage(params.pageId).waitForSelector(
      params.selector,
      params.options,
    );
    return { matched };
  }

  async pageScreenshot(params: PageScreenshotParams): Promise<PageScreenshotResult> {
    const page = this.resolvePage(params.pageId);
    let options: UnderstudyRuntimeScreenshotOptions | undefined;

    if (params.options) {
      const { mask, ...screenshotOptions } = params.options;
      const resolvedMask = mask?.map((descriptor) => {
        if (descriptor.pageId !== params.pageId) {
          throw new TypeError("page.screenshot: mask locators must belong to the target page");
        }
        return this.resolveLocator(descriptor);
      });
      options = {
        ...screenshotOptions,
        ...(resolvedMask ? { mask: resolvedMask } : {}),
      };
    }

    const bytes = await page.screenshot(options);
    return {
      data: bytesToBase64(bytes),
    };
  }

  async pagePDF(params: PagePDFParams): Promise<PagePDFResult> {
    return await this.resolvePage(params.pageId).pdf(params.options);
  }

  async pageSnapshot(params: PageSnapshotParams): Promise<SnapshotResult> {
    return await this.resolvePage(params.pageId).snapshot(params.options);
  }

  async pageWebMCPTools(params: PageWebMCPToolsParams): Promise<PageWebMCPToolsResult> {
    return {
      tools: await this.resolvePage(params.pageId).listWebMCPTools(params.options),
    };
  }

  async pageWebMCPInvokeTool(
    params: PageWebMCPInvokeToolParams,
  ): Promise<WebMCPInvocationDescriptor> {
    return await this.resolvePage(params.pageId).invokeWebMCPTool(params.frameId, params.toolName, {
      input: params.input,
    });
  }

  async pageWebMCPInvocationResult(
    params: PageWebMCPInvocationResultParams,
  ): Promise<WebMCPToolResponse> {
    return await this.resolvePage(params.pageId).waitForWebMCPInvocationResult(
      params.invocationId,
      params.options,
    );
  }

  async pageWebMCPCancelInvocation(
    params: PageWebMCPCancelInvocationParams,
  ): Promise<PageVoidResult> {
    await this.resolvePage(params.pageId).cancelWebMCPInvocation(params.invocationId);
    return { ok: true };
  }

  pageUrl(params: PageIdParams): PageUrlResult {
    return this.resolvePage(params.pageId).url();
  }

  async pageTitle(params: PageIdParams): Promise<PageTitleResult> {
    return await this.resolvePage(params.pageId).title();
  }

  async pageClose(params: PageIdParams): Promise<PageCloseResult> {
    const page = this.resolvePage(params.pageId);
    this.disposePageEventSubscriptions(params.pageId, true);
    await page.close();
    this.forgetPage(params.pageId);
    return { closed: true };
  }

  async pageOn(params: PageOnParams): Promise<PageVoidResult> {
    if (this.pageEventSubscriptions.has(params.subscriptionId)) {
      throw new DuplicatePageEventSubscriptionError();
    }
    const page = this.resolvePage(params.pageId);
    const subscription: RuntimePageEventSubscription = {
      pageId: params.pageId,
      event: params.event,
      controller: new AbortController(),
    };
    this.pageEventSubscriptions.set(params.subscriptionId, subscription);
    try {
      const isActive = () =>
        this.pageEventSubscriptions.get(params.subscriptionId) === subscription &&
        !subscription.controller.signal.aborted;
      switch (params.event) {
        case "console":
          subscription.dispose = await page.subscribeCDPEvent(
            params.event,
            (event) => {
              if (!isActive()) return;
              this.adapters.emitPageCDPEvent({ subscriptionId: params.subscriptionId, event });
            },
            subscription.controller.signal,
          );
          break;
        case "toolsadded":
        case "toolsremoved":
          subscription.dispose = await page.subscribeWebMCPToolsChanged((event) => {
            if (!isActive() || event.event !== params.event) return;
            this.adapters.emitPageEvent({ ...event, subscriptionId: params.subscriptionId });
          }, subscription.controller.signal);
          break;
        default: {
          const unsupportedEvent: never = params.event;
          throw new Error(`Unsupported page subscription event: ${unsupportedEvent}`);
        }
      }
      subscription.controller.signal.throwIfAborted();
      return { ok: true };
    } catch (error) {
      subscription.controller.abort();
      subscription.dispose?.();
      if (this.pageEventSubscriptions.get(params.subscriptionId) === subscription) {
        this.pageEventSubscriptions.delete(params.subscriptionId);
      }
      throw error;
    }
  }

  pageOff(params: PageOffParams): PageVoidResult {
    // A client page.off also cancels a replay that is waiting on a reconnect.
    this.pendingPageEventResubscriptions.delete(params.subscriptionId);
    this.disposePageEventSubscription(params.subscriptionId);
    return { ok: true };
  }

  /** Tears down a live subscription without forgetting a pending reconnect replay of it. */
  private disposePageEventSubscription(subscriptionId: string): void {
    const subscription = this.pageEventSubscriptions.get(subscriptionId);
    if (!subscription) return;
    subscription.controller.abort();
    subscription.dispose?.();
    this.pageEventSubscriptions.delete(subscriptionId);
  }

  async locatorClick(params: LocatorClickParams): Promise<LocatorClickResult> {
    await this.runLocator("locator.click", params, (locator, progress) =>
      locator.click(params.options, progress),
    );
    return { clicked: true };
  }

  async locatorHover(params: LocatorParams): Promise<LocatorHoverResult> {
    await this.runLocator("locator.hover", params, (locator, progress) => locator.hover(progress));
    return { hovered: true };
  }

  async locatorFill(params: LocatorFillParams): Promise<LocatorFillResult> {
    await this.runLocator("locator.fill", params, (locator, progress) =>
      locator.fill(params.value, progress),
    );
    return { filled: true };
  }

  async locatorCount(params: LocatorParams): Promise<LocatorCountResult> {
    return await this.runLocator("locator.count", params, (locator, progress) =>
      locator.count(progress),
    );
  }

  async locatorIsChecked(params: LocatorParams): Promise<LocatorIsCheckedResult> {
    return await this.runLocator("locator.is_checked", params, (locator, progress) =>
      locator.isChecked(progress),
    );
  }

  async locatorInputValue(params: LocatorParams): Promise<LocatorInputValueResult> {
    return await this.runLocator("locator.input_value", params, (locator, progress) =>
      locator.inputValue(progress),
    );
  }

  async locatorIsVisible(params: LocatorParams): Promise<LocatorIsVisibleResult> {
    return await this.runLocator("locator.is_visible", params, (locator, progress) =>
      locator.isVisible(progress),
    );
  }

  async locatorInnerText(params: LocatorParams): Promise<LocatorInnerTextResult> {
    return await this.runLocator("locator.inner_text", params, (locator, progress) =>
      locator.innerText(progress),
    );
  }

  async locatorInnerHtml(params: LocatorParams): Promise<LocatorInnerHtmlResult> {
    return await this.runLocator("locator.inner_html", params, (locator, progress) =>
      locator.innerHtml(progress),
    );
  }

  async locatorTextContent(params: LocatorParams): Promise<LocatorTextContentResult> {
    return await this.runLocator("locator.text_content", params, (locator, progress) =>
      locator.textContent(progress),
    );
  }

  async locatorScrollTo(params: LocatorScrollToParams): Promise<LocatorScrollToResult> {
    await this.runLocator("locator.scroll_to", params, (locator, progress) =>
      locator.scrollTo(params.percent, progress),
    );
    return { scrolled: true };
  }

  async locatorCentroid(params: LocatorParams): Promise<LocatorCentroidResult> {
    return await this.runLocator("locator.centroid", params, (locator, progress) =>
      locator.centroid(progress),
    );
  }

  async locatorHighlight(params: LocatorHighlightParams): Promise<LocatorHighlightResult> {
    await this.runLocator("locator.highlight", params, (locator, progress) =>
      locator.highlight(params.options, progress),
    );
    return { highlighted: true };
  }

  async locatorSendClickEvent(
    params: LocatorSendClickEventParams,
  ): Promise<LocatorSendClickEventResult> {
    await this.runLocator("locator.send_click_event", params, (locator, progress) =>
      locator.sendClickEvent(params.options, progress),
    );
    return { clicked: true };
  }

  async locatorType(params: LocatorTypeParams): Promise<LocatorTypeResult> {
    await this.runLocator("locator.type", params, (locator, progress) =>
      locator.type(params.text, params.options, progress),
    );
    return { typed: true };
  }

  async locatorSelectOption(params: LocatorSelectOptionParams): Promise<LocatorSelectOptionResult> {
    return await this.runLocator("locator.select_option", params, (locator, progress) =>
      locator.selectOption(params.values, progress),
    );
  }

  async locatorSetInputFiles(
    params: LocatorSetInputFilesParams,
  ): Promise<LocatorSetInputFilesResult> {
    await this.runLocator("locator.set_input_files", params, (locator, progress) =>
      locator.setInputFiles(
        params.files.map((file) => {
          progress.throwIfStopped();
          const binary = globalThis.atob(file.data);
          const buffer = new Uint8Array(binary.length);
          for (let index = 0; index < binary.length; index += 1) {
            buffer[index] = binary.charCodeAt(index);
          }
          return {
            name: file.name,
            mimeType: file.mimeType,
            buffer,
            lastModified: file.lastModified,
          };
        }),
        progress,
      ),
    );
    return { set: true };
  }

  private runLocator<T>(
    name: string,
    params: LocatorParams,
    action: (locator: UnderstudyRuntimeLocator, progress: Progress) => Promise<T> | T,
  ): Promise<T> {
    return runWithProgress(
      { name, timeout: params.options?.timeout ?? DEFAULT_LOCATOR_TIMEOUT_MS },
      async (progress) => action(this.resolveLocator(params), progress),
    );
  }

  async close(): Promise<void> {
    await this.enqueueLifecycle(async () => {
      ++this.browserSessionGeneration;
      const session = this.browserSession;
      this.browserSession = undefined;
      this.clearStagehandInstance();
      await session?.close();
    });
  }

  async disposeStagehandInstance(): Promise<void> {
    if (this.stagehandInstanceDisposal) return await this.stagehandInstanceDisposal;

    this.stagehandInstanceClosing = true;
    const disposal = this.enqueueLifecycle(async () => {
      // Pending registrations must release their request leases before disposal can drain them.
      this.disposeAllPageEventSubscriptions();
      await this.waitForStagehandInstanceRequests();
      this.clearStagehandInstance();
    });
    this.stagehandInstanceDisposal = disposal.finally(() => {
      this.stagehandInstanceClosing = false;
      this.stagehandInstanceDisposal = undefined;
    });
    return await this.stagehandInstanceDisposal;
  }

  acquireStagehandInstanceRequest(): () => void {
    if (this.stagehandInstanceClosing) {
      throw new Error("Stagehand instance is closing");
    }

    this.activeStagehandInstanceRequests += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.activeStagehandInstanceRequests -= 1;
      if (this.activeStagehandInstanceRequests !== 0) return;
      this.stagehandInstanceRequestsDrained?.resolve();
      this.stagehandInstanceRequestsDrained = undefined;
    };
  }

  private clearStagehandInstance(): void {
    this.disposeAllPageEventSubscriptions();
    this.pendingPageEventResubscriptions.clear();
    this.pendingPageEventResubscriptions.clear();
    this.pagesById.clear();
    this.responseHandles.clear();
    this.contextInitScripts.length = 0;
    this.contextExtraHTTPHeaders = undefined;
    this.contextDomainPolicy = undefined;
    this.pageInitScriptsById.clear();
    this.pageExtraHTTPHeadersById.clear();
    this.pageViewportById.clear();
    this.metrics.reset();
    this.state.setState(StagehandRuntimeStateSchema.parse({ status: "idle" }), true);
  }

  private enqueueLifecycle<Result>(run: () => Promise<Result>): Promise<Result> {
    const result = this.lifecycleTail.then(run, run);
    this.lifecycleTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private waitForStagehandInstanceRequests(): Promise<void> {
    if (this.activeStagehandInstanceRequests === 0) return Promise.resolve();
    if (!this.stagehandInstanceRequestsDrained) {
      let resolve!: () => void;
      const promise = new Promise<void>((drained) => {
        resolve = drained;
      });
      this.stagehandInstanceRequestsDrained = { promise, resolve };
    }
    return this.stagehandInstanceRequestsDrained.promise;
  }

  pageRefForId(pageId: string): PageRef {
    return pageRefFromUnderstudyPage(this.resolvePage(pageId));
  }

  resolvePage(pageId: string): UnderstudyRuntimePage {
    const cachedPage = this.pagesById.get(pageId);
    if (cachedPage) return cachedPage;

    this.refreshPageRegistry(this.requireBrowserSession().pages());
    const refreshedPage = this.pagesById.get(pageId);
    if (refreshedPage) return refreshedPage;

    throw new Error(`Stagehand page "${pageId}" was not found; call context.pages and retry`);
  }

  resolveUnderstudyPage(pageId: string): Page {
    const page = this.resolvePage(pageId);
    if (!(page instanceof Page)) {
      throw new TypeError(`Stagehand page "${pageId}" is not backed by an Understudy page`);
    }
    return page;
  }

  resolveLocator(params: LocatorDescriptor): UnderstudyRuntimeLocator {
    const locator = this.resolvePage(params.pageId).deepLocator(params.selector);
    return params.nth === undefined ? locator : locator.nth(params.nth);
  }

  clipboardOptions(pageId?: string): UnderstudyRuntimeClipboardOptions | undefined {
    return pageId === undefined ? undefined : { page: this.resolvePage(pageId) };
  }

  refreshPageRegistry(pages: UnderstudyRuntimePage[]): void {
    const currentPageIds = new Set<string>();

    for (const page of pages) {
      const pageId = this.registerPage(page);
      currentPageIds.add(pageId);
    }

    for (const pageId of this.pagesById.keys()) {
      if (!currentPageIds.has(pageId)) {
        this.forgetPage(pageId);
      }
    }
  }

  private forgetPage(pageId: string): void {
    this.disposePageEventSubscriptions(pageId);
    this.pagesById.delete(pageId);
    this.responseHandles.deleteForPage(pageId);
    this.pageInitScriptsById.delete(pageId);
    this.pageExtraHTTPHeadersById.delete(pageId);
    this.pageViewportById.delete(pageId);
  }

  private disposePageEventSubscriptions(pageId: string, pendingOnly = false): void {
    for (const [subscriptionId, subscription] of this.pageEventSubscriptions) {
      if (subscription.pageId !== pageId) continue;
      if (pendingOnly && subscription.dispose) continue;
      this.disposePageEventSubscription(subscriptionId);
    }
  }

  private disposeAllPageEventSubscriptions(): void {
    for (const subscriptionId of this.pageEventSubscriptions.keys())
      this.disposePageEventSubscription(subscriptionId);
  }

  registerPage(page: UnderstudyRuntimePage): string {
    const pageId = page.targetId();
    this.pagesById.set(pageId, page);
    return pageId;
  }

  private pageNavigationResult(
    pageId: string,
    page: UnderstudyRuntimePage,
    response: unknown,
  ): PageNavigationResult {
    const pageRef = pageRefFromUnderstudyPage(page);
    if (!(response instanceof Response)) return { page: pageRef, response: null };

    const responseId = this.responseHandles.register(pageId, response);
    return {
      page: pageRef,
      response: {
        responseId,
        url: response.url(),
        status: response.status(),
        statusText: response.statusText(),
        headers: response.headers(),
        fromServiceWorker: response.fromServiceWorker(),
      },
    };
  }

  requireBrowserSession(): StagehandBrowserSession {
    if (!this.browserSession) {
      throw new Error("Stagehand loopback CDP is not configured");
    }

    if (!this.browserSession.connected) {
      throw new Error("Stagehand loopback CDP is disconnected");
    }

    return this.browserSession;
  }
}

function pageRefFromUnderstudyPage(page: UnderstudyRuntimePage): PageRef {
  return {
    pageId: page.targetId(),
    url: page.url(),
  };
}

function hydrateClearCookieOptions(
  options: ClearCookieOptions | undefined,
): UnderstudyRuntimeClearCookieOptions | undefined {
  if (options === undefined) return undefined;
  return {
    ...(options.name === undefined ? {} : { name: hydrateCookieFilter(options.name) }),
    ...(options.domain === undefined ? {} : { domain: hydrateCookieFilter(options.domain) }),
    ...(options.path === undefined ? {} : { path: hydrateCookieFilter(options.path) }),
  };
}

function hydrateCookieFilter(filter: CookieFilter): string | RegExp {
  if (typeof filter === "string") return filter;
  return new RegExp(filter.source, filter.flags);
}

/** Resolves true when the promise settles first, false when the timeout wins. */
async function settledWithin(promise: Promise<unknown>, timeoutMs: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });
  try {
    return await Promise.race([
      promise.then(
        () => true,
        () => true,
      ),
      timeout,
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

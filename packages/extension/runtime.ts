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
  ContextCloseResult,
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
} from "../protocol/types.js";
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
import { Page } from "./understudy/page.js";
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
  subscribeCDPEvent(listener: (event: PageCDPEvent) => void): () => void;
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
  click(options?: LocatorClickParams["options"]): Promise<void> | void;
  hover(): Promise<void> | void;
  fill(value: string): Promise<void> | void;
  count(): Promise<number>;
  isChecked(): Promise<boolean>;
  inputValue(): Promise<string>;
  isVisible(): Promise<boolean>;
  innerText(): Promise<string>;
  innerHtml(): Promise<string>;
  textContent(): Promise<string>;
  scrollTo(percent: LocatorScrollToParams["percent"]): Promise<void> | void;
  centroid(): Promise<LocatorCentroidResult>;
  highlight(options?: LocatorHighlightParams["options"]): Promise<void> | void;
  sendClickEvent(options?: LocatorSendClickEventParams["options"]): Promise<void> | void;
  type(text: string, options?: LocatorTypeParams["options"]): Promise<void> | void;
  selectOption(values: LocatorSelectOptionParams["values"]): Promise<string[]>;
  setInputFiles(files: SetInputFilesArgument): Promise<void>;
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
    },
    tracing,
  );
}

export class StagehandRuntime {
  readonly logger: StagehandLogger;
  readonly metrics = new StagehandMetricsAccumulator();
  readonly responseHandles = new ResponseHandleTable();
  readonly state = createStore<StagehandRuntimeState>()(() =>
    StagehandRuntimeStateSchema.parse({ status: "created" }),
  );
  browserSession?: StagehandBrowserSession;
  pagesById = new Map<string, UnderstudyRuntimePage>();
  private readonly pageEventSubscriptions = new Map<
    string,
    { pageId: string; event: PageOnParams["event"]; dispose: () => void }
  >();
  private readonly pendingPageEventResubscriptions = new Map<
    string,
    Pick<PageOnParams, "pageId" | "event">
  >();
  private browserSessionGeneration = 0;
  private browserSessionPending?: Promise<void>;
  private browserSessionRecovery?: () => Promise<void> | undefined;
  private initializationInProgress = false;
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
    const state = this.state.getState();
    if (state.status === "closed") {
      throw new Error("Stagehand has been closed and cannot be initialized again");
    }
    if (this.initializationInProgress) {
      throw new Error("Stagehand initialization is already in progress");
    }
    this.initializationInProgress = true;

    try {
      this.logger.setLevel(params.logLevel);
      if (!this.browserSession) {
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
          if (state.status === "created") {
            await this.browserSession?.prepareForInitialization?.();
          }
          return await this.contextPages();
        },
      );
      this.tracing.configure(params.telemetry, params.clientInfo);
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
      this.pageOn({ pageId, subscriptionId, event });
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

  async contextClose(): Promise<ContextCloseResult> {
    await this.close();
    return { closed: true };
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
      type: params.options?.type ?? "png",
    };
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
    await page.close();
    this.forgetPage(params.pageId);
    return { closed: true };
  }

  pageOn(params: PageOnParams): PageVoidResult {
    if (this.pageEventSubscriptions.has(params.subscriptionId)) {
      throw new DuplicatePageEventSubscriptionError();
    }
    const dispose = this.resolvePage(params.pageId).subscribeCDPEvent((event) => {
      this.adapters.emitPageCDPEvent({ subscriptionId: params.subscriptionId, event });
    });
    this.pageEventSubscriptions.set(params.subscriptionId, {
      pageId: params.pageId,
      event: params.event,
      dispose,
    });
    return { ok: true };
  }

  pageOff(params: PageOffParams): PageVoidResult {
    this.pendingPageEventResubscriptions.delete(params.subscriptionId);
    const subscription = this.pageEventSubscriptions.get(params.subscriptionId);
    if (!subscription) return { ok: true };
    subscription.dispose();
    this.pageEventSubscriptions.delete(params.subscriptionId);
    return { ok: true };
  }

  async locatorClick(params: LocatorClickParams): Promise<LocatorClickResult> {
    await this.resolveLocator(params).click(params.options);
    return { clicked: true };
  }

  async locatorHover(params: LocatorDescriptor): Promise<LocatorHoverResult> {
    await this.resolveLocator(params).hover();
    return { hovered: true };
  }

  async locatorFill(params: LocatorFillParams): Promise<LocatorFillResult> {
    await this.resolveLocator(params).fill(params.value);
    return { filled: true };
  }

  async locatorCount(params: LocatorDescriptor): Promise<LocatorCountResult> {
    return await this.resolveLocator(params).count();
  }

  async locatorIsChecked(params: LocatorDescriptor): Promise<LocatorIsCheckedResult> {
    return await this.resolveLocator(params).isChecked();
  }

  async locatorInputValue(params: LocatorDescriptor): Promise<LocatorInputValueResult> {
    return await this.resolveLocator(params).inputValue();
  }

  async locatorIsVisible(params: LocatorDescriptor): Promise<LocatorIsVisibleResult> {
    return await this.resolveLocator(params).isVisible();
  }

  async locatorInnerText(params: LocatorDescriptor): Promise<LocatorInnerTextResult> {
    return await this.resolveLocator(params).innerText();
  }

  async locatorInnerHtml(params: LocatorDescriptor): Promise<LocatorInnerHtmlResult> {
    return await this.resolveLocator(params).innerHtml();
  }

  async locatorTextContent(params: LocatorDescriptor): Promise<LocatorTextContentResult> {
    return await this.resolveLocator(params).textContent();
  }

  async locatorScrollTo(params: LocatorScrollToParams): Promise<LocatorScrollToResult> {
    await this.resolveLocator(params).scrollTo(params.percent);
    return { scrolled: true };
  }

  async locatorCentroid(params: LocatorDescriptor): Promise<LocatorCentroidResult> {
    return await this.resolveLocator(params).centroid();
  }

  async locatorHighlight(params: LocatorHighlightParams): Promise<LocatorHighlightResult> {
    await this.resolveLocator(params).highlight(params.options);
    return { highlighted: true };
  }

  async locatorSendClickEvent(
    params: LocatorSendClickEventParams,
  ): Promise<LocatorSendClickEventResult> {
    await this.resolveLocator(params).sendClickEvent(params.options);
    return { clicked: true };
  }

  async locatorType(params: LocatorTypeParams): Promise<LocatorTypeResult> {
    await this.resolveLocator(params).type(params.text, params.options);
    return { typed: true };
  }

  async locatorSelectOption(params: LocatorSelectOptionParams): Promise<LocatorSelectOptionResult> {
    return await this.resolveLocator(params).selectOption(params.values);
  }

  async locatorSetInputFiles(
    params: LocatorSetInputFilesParams,
  ): Promise<LocatorSetInputFilesResult> {
    await this.resolveLocator(params).setInputFiles(
      params.files.map((file) => {
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
    );
    return { set: true };
  }

  async close(): Promise<void> {
    ++this.browserSessionGeneration;
    const session = this.browserSession;
    this.browserSession = undefined;
    this.disposeAllPageEventSubscriptions();
    this.pendingPageEventResubscriptions.clear();
    this.pagesById.clear();
    this.responseHandles.clear();
    this.pageInitScriptsById.clear();
    this.pageExtraHTTPHeadersById.clear();
    this.pageViewportById.clear();
    try {
      await session?.close();
    } finally {
      this.state.setState(StagehandRuntimeStateSchema.parse({ status: "closed" }), true);
    }
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

  private disposePageEventSubscriptions(pageId: string): void {
    for (const [subscriptionId, subscription] of this.pageEventSubscriptions) {
      if (subscription.pageId !== pageId) continue;
      subscription.dispose();
      this.pageEventSubscriptions.delete(subscriptionId);
    }
  }

  private disposeAllPageEventSubscriptions(): void {
    for (const subscription of this.pageEventSubscriptions.values()) subscription.dispose();
    this.pageEventSubscriptions.clear();
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

import type { ClientBrowserbaseRequest } from "./clients/browserbaseClient.js";
import {
  DEFAULT_LOCATOR_TIMEOUT_MS,
  DecisionChooseParamsSchema,
  createDecisionChooseResultSchema,
} from "@browserbasehq/stagehand-protocol/schemas";
import { runWithProgress, type Progress } from "./understudy/progress.js";
import { DecisionModelNotConfiguredError, ShadowRootEvaluationUnavailableError } from "./errors.js";
import type {
  DecisionChooseParams,
  DecisionChooseResult,
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
  PageApcParams,
  PageApcOptions,
  PageApcResult,
  PageSnapshotParams,
  PageSnapshotOptions,
  PageTitleResult,
  PageTypeParams,
  PageUrlResult,
  PageVoidResult,
  PageWaitForLoadStateParams,
  PageWaitForSelectorParams,
  PageWaitForFunctionParams,
  PageWaitForFunctionResult,
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
import { resolvePromptLocator } from "./understudy/promptLocator.js";
import type { ApcLocatorOperation } from "./understudy/annotatedPageContent/candidates.js";
import { ChainTargetLocator, type ChainTarget } from "./understudy/locatorChain.js";
import { hasPromptSelector, assertDeterministicLocator } from "./understudy/locatorGuards.js";
import { PromptLocatorNoMatchError, UnsupportedPromptLocatorError } from "./errors.js";
import { Response } from "./understudy/response.js";
import { StagehandMetricsAccumulator } from "./metrics.js";
import { ResponseHandleTable } from "./responseHandleTable.js";
import { DuplicatePageEventSubscriptionError } from "./errors.js";

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
  waitForFunction(
    expression: string,
    options?: PageWaitForFunctionParams["options"],
  ): Promise<unknown>;
  screenshot(options?: UnderstudyRuntimeScreenshotOptions): Promise<Uint8Array>;
  pdf(options?: PagePDFOptions): Promise<PagePDFResult>;
  apc(options?: PageApcOptions): Promise<PageApcResult>;
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
  deepLocator(selector: LocatorDescriptor["selector"]): UnderstudyRuntimeLocator;
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

export type StagehandBrowserSessionFactory = (
  cdpUrl: string,
  logger: StagehandLogger,
  bootstrapLogger?: StagehandLogger,
) => Promise<StagehandBrowserSession>;

export type StagehandRuntimeAdapters = {
  browserSessionFactory?: StagehandBrowserSessionFactory;
  emitLog?: StagehandLogEmitter;
  clientLLMGenerate?: (params: LLMGenerateParams) => Promise<LLMGenerateResult>;
  clientDecisionChoose?: (
    params: DecisionChooseParams,
    signal: AbortSignal,
  ) => Promise<DecisionChooseResult>;
  clientBrowserbaseRequest?: ClientBrowserbaseRequest;
  emitPageCDPEvent?: (notification: PageCDPEventNotification) => void;
  emitPageEvent?: (notification: PageEventNotification) => void;
};

type ResolvedStagehandRuntimeAdapters = Required<StagehandRuntimeAdapters>;

const defaultBrowserSessionFactory: StagehandBrowserSessionFactory = async () => {
  throw new Error("Stagehand browser session factory is not configured");
};
const discardLog: StagehandLogEmitter = () => {};
const discardPageCDPEvent = (): void => {};
const unavailableClientBrowserbase = async (): Promise<never> => {
  throw new Error("The connected SDK did not register a Browserbase transport");
};
const unavailableClientLLM = async (): Promise<never> => {
  throw new Error("The connected SDK did not register a client-side LLM");
};
const unavailableClientDecision = async (): Promise<never> => {
  throw new DecisionModelNotConfiguredError();
};

export function createStagehandRuntime(
  adapters: StagehandRuntimeAdapters = {},
  tracing: StagehandTracing = createStagehandTracing(),
): StagehandRuntime {
  return new StagehandRuntime(
    {
      browserSessionFactory: adapters.browserSessionFactory ?? defaultBrowserSessionFactory,
      emitLog: adapters.emitLog ?? discardLog,
      clientLLMGenerate: adapters.clientLLMGenerate ?? unavailableClientLLM,
      clientDecisionChoose: adapters.clientDecisionChoose ?? unavailableClientDecision,
      clientBrowserbaseRequest: adapters.clientBrowserbaseRequest ?? unavailableClientBrowserbase,
      emitPageCDPEvent: adapters.emitPageCDPEvent ?? discardPageCDPEvent,
      emitPageEvent: adapters.emitPageEvent ?? discardPageCDPEvent,
    },
    tracing,
  );
}

type RuntimePageEventSubscription = {
  pageId: string;
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
  private browserSessionCdpUrl?: string;
  // Retain disconnected sessions until cleanup succeeds; undefined permits a retry.
  private readonly pendingBrowserSessionCleanup = new Map<
    StagehandBrowserSession,
    Promise<void> | undefined
  >();
  /** Bumped whenever B is replaced or dropped; a connect that finishes late checks it. */
  private browserConnectionGeneration = 0;
  private initializationInProgress = false;
  private lifecycleTail = Promise.resolve();
  private stagehandInstanceClosing = false;
  private readonly decisionControllers = new Set<AbortController>();
  private readonly promptOperations = new Set<Progress>();
  private activeStagehandInstanceRequests = 0;
  private stagehandInstanceRequestsDrained?: {
    promise: Promise<void>;
    resolve: () => void;
  };
  private stagehandInstanceDisposal?: Promise<void>;

  constructor(
    readonly adapters: ResolvedStagehandRuntimeAdapters,
    readonly tracing: StagehandTracing,
  ) {
    this.logger = new StagehandLogger(tracing, adapters.emitLog);
  }

  async replaceBrowserConnection(
    params: { cdpUrl: string },
    bootstrapLogger?: StagehandLogger,
  ): Promise<void> {
    const { cdpUrl } = params;
    const generation = ++this.browserConnectionGeneration;
    if (this.browserSession && !this.pendingBrowserSessionCleanup.has(this.browserSession)) {
      this.pendingBrowserSessionCleanup.set(this.browserSession, undefined);
    }
    this.browserSession = undefined;
    this.browserSessionCdpUrl = undefined;
    this.disposeAllPageEventSubscriptions();
    this.pagesById.clear();
    this.responseHandles.clear();
    await this.runPendingSessionCleanup();
    if (generation !== this.browserConnectionGeneration) {
      throw new Error("Stagehand browser connection was dropped while connecting");
    }

    const session = await this.adapters.browserSessionFactory(cdpUrl, this.logger, bootstrapLogger);
    if (generation !== this.browserConnectionGeneration) {
      // Late connections also need a retained cleanup handle if close rejects.
      await this.cleanupSession(session);
      throw new Error("Stagehand browser connection was dropped while connecting");
    }
    this.browserSession = session;
    this.browserSessionCdpUrl = cdpUrl;
  }

  /**
   * Closes the runtime's own browser connection immediately, outside the lifecycle
   * queue: a lost client must not wait behind lifecycle work that needs that client.
   */
  async disconnectBrowser(): Promise<void> {
    // Invalidates a connection still being opened, so it closes instead of being installed.
    this.browserConnectionGeneration += 1;
    if (this.browserSession && !this.pendingBrowserSessionCleanup.has(this.browserSession)) {
      this.pendingBrowserSessionCleanup.set(this.browserSession, undefined);
    }
    this.browserSession = undefined;
    this.browserSessionCdpUrl = undefined;
    await this.runPendingSessionCleanup();
  }

  private cleanupSession(session: StagehandBrowserSession): Promise<void> {
    const pending = this.pendingBrowserSessionCleanup.get(session);
    if (pending) return pending;
    const closing = Promise.resolve()
      .then(() => session.close())
      .then(
        () => {
          this.pendingBrowserSessionCleanup.delete(session);
        },
        (error) => {
          this.pendingBrowserSessionCleanup.set(session, undefined);
          throw error;
        },
      );
    this.pendingBrowserSessionCleanup.set(session, closing);
    return closing;
  }

  private async runPendingSessionCleanup(): Promise<void> {
    const results = await Promise.allSettled(
      Array.from(this.pendingBrowserSessionCleanup.keys(), (session) =>
        this.cleanupSession(session),
      ),
    );
    const errors = results.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : [],
    );
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, "Browser session cleanup failed");
  }

  async ensureBrowserConnection(cdpUrl: string): Promise<void> {
    if (!this.browserSession?.connected || this.browserSessionCdpUrl !== cdpUrl) {
      await this.replaceBrowserConnection({ cdpUrl });
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
        if (
          !this.browserSession?.connected ||
          (params.browserCdpUrl !== undefined && params.browserCdpUrl !== this.browserSessionCdpUrl)
        ) {
          if (!params.browserCdpUrl) {
            throw new Error("stagehand.init requires browserCdpUrl until resident mode is active");
          }
          await this.replaceBrowserConnection({ cdpUrl: params.browserCdpUrl }, logger);
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
      state.status === "initialized"
        ? buildGatewayContext(state.initParams, this.adapters.clientBrowserbaseRequest)
        : undefined;
    if (!model && !gateway) {
      throw new Error("An LLM was not configured during Stagehand initialization");
    }
    return await llmService.generate(model, input, this.adapters.clientLLMGenerate, gateway);
  }

  /** Selection runs in the SDK; ordinary locator execution consumes the chosen ID later. */
  async chooseDecision(
    input: DecisionChooseParams,
    parentProgress?: Progress,
  ): Promise<DecisionChooseResult> {
    const state = this.state.getState();
    if (state.status !== "initialized" || !state.initParams.decisionModel) {
      throw new DecisionModelNotConfiguredError();
    }
    if (this.stagehandInstanceClosing) throw new Error("Stagehand instance is closing");
    const params = DecisionChooseParamsSchema.parse(input);
    const resultSchema = createDecisionChooseResultSchema(params);
    return runWithProgress(
      parentProgress ?? { name: "decision", timeout: DEFAULT_LOCATOR_TIMEOUT_MS },
      async (progress) => {
        if (this.stagehandInstanceClosing || this.state.getState() !== state) {
          throw new Error("Stagehand decision request is no longer active");
        }
        const controller = new AbortController();
        this.decisionControllers.add(controller);
        const signal = AbortSignal.any([progress.signal, controller.signal]);
        let onAbort: (() => void) | undefined;
        try {
          const result = await progress.run("choosing a locator candidate", () => {
            signal.throwIfAborted();
            const stopped = new Promise<never>((_, reject) => {
              onAbort = () => reject(signal.reason);
              signal.addEventListener("abort", onAbort, { once: true });
            });
            const remaining = progress.remainingMs();
            // Always use the owning operation's clock, not a fresh callback timeout.
            const { timeoutMs: _timeoutMs, ...input } = params;
            return Promise.race([
              Promise.resolve().then(() => {
                signal.throwIfAborted();
                return this.adapters.clientDecisionChoose(
                  {
                    ...input,
                    ...(Number.isFinite(remaining) ? { timeoutMs: remaining } : {}),
                  },
                  signal,
                );
              }),
              stopped,
            ]);
          });
          signal.throwIfAborted();
          if (this.stagehandInstanceClosing || this.state.getState() !== state) {
            throw new Error("Stagehand decision request is no longer active");
          }
          return resultSchema.parse(result);
        } finally {
          if (onAbort) signal.removeEventListener("abort", onAbort);
          this.decisionControllers.delete(controller);
        }
      },
    );
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
    return { ok: true };
  }

  async contextSetExtraHTTPHeaders(
    params: ContextSetExtraHTTPHeadersParams,
  ): Promise<ContextVoidResult> {
    await this.requireBrowserSession().setExtraHTTPHeaders(params.headers);
    return { ok: true };
  }

  contextGetDomainPolicy(): ContextGetDomainPolicyResult {
    return this.requireBrowserSession().getDomainPolicy();
  }

  async contextSetDomainPolicy(params: ContextSetDomainPolicyParams): Promise<ContextVoidResult> {
    await this.requireBrowserSession().setDomainPolicy(params.policy);
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
    return { ok: true };
  }

  async pageSetExtraHTTPHeaders(params: PageSetExtraHTTPHeadersParams): Promise<PageVoidResult> {
    await this.resolvePage(params.pageId).setExtraHTTPHeaders(params.headers);
    return { ok: true };
  }

  async pageSetViewportSize(params: PageSetViewportSizeParams): Promise<PageVoidResult> {
    await this.resolvePage(params.pageId).setViewportSize(
      params.width,
      params.height,
      params.options,
    );
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

  async pageWaitForFunction(params: PageWaitForFunctionParams): Promise<PageWaitForFunctionResult> {
    const value = await this.resolvePage(params.pageId).waitForFunction(
      params.expression,
      params.options,
    );
    return { value: value as PageWaitForFunctionResult["value"] };
  }

  async pageScreenshot(params: PageScreenshotParams): Promise<PageScreenshotResult> {
    const page = this.resolvePage(params.pageId);
    let options: UnderstudyRuntimeScreenshotOptions | undefined;

    if (params.options) {
      const { mask, ...screenshotOptions } = params.options;
      const resolvedMask = mask?.map((descriptor) => {
        assertDeterministicLocator(descriptor.selector, "screenshot masks");
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

  async pageApc(params: PageApcParams): Promise<PageApcResult> {
    return await this.resolvePage(params.pageId).apc(params.options);
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
    this.disposePageEventSubscriptions(params.pageId);
    this.pagesById.delete(params.pageId);
    this.responseHandles.deleteForPage(params.pageId);
    return { closed: true };
  }

  async pageOn(params: PageOnParams): Promise<PageVoidResult> {
    if (this.pageEventSubscriptions.has(params.subscriptionId)) {
      throw new DuplicatePageEventSubscriptionError();
    }
    const page = this.resolvePage(params.pageId);
    const subscription: RuntimePageEventSubscription = {
      pageId: params.pageId,
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
    const subscription = this.pageEventSubscriptions.get(params.subscriptionId);
    if (!subscription) return { ok: true };
    subscription.controller.abort();
    subscription.dispose?.();
    this.pageEventSubscriptions.delete(params.subscriptionId);
    return { ok: true };
  }

  async locatorClick(params: LocatorClickParams): Promise<LocatorClickResult> {
    await this.runLocator(
      "locator.click",
      params,
      (locator, progress) => locator.click(params.options, progress),
      "click",
    );
    return { clicked: true };
  }

  async locatorHover(params: LocatorParams): Promise<LocatorHoverResult> {
    await this.runLocator(
      "locator.hover",
      params,
      (locator, progress) => locator.hover(progress),
      "hover",
    );
    return { hovered: true };
  }

  async locatorFill(params: LocatorFillParams): Promise<LocatorFillResult> {
    await this.runLocator(
      "locator.fill",
      params,
      (locator, progress) => locator.fill(params.value, progress),
      "fill",
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
    await this.runLocator(
      "locator.scroll_to",
      params,
      (locator, progress) => locator.scrollTo(params.percent, progress),
      "scrollTo",
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
    await this.runLocator(
      "locator.send_click_event",
      params,
      (locator, progress) => locator.sendClickEvent(params.options, progress),
      "sendClickEvent",
    );
    return { clicked: true };
  }

  async locatorType(params: LocatorTypeParams): Promise<LocatorTypeResult> {
    await this.runLocator(
      "locator.type",
      params,
      (locator, progress) => locator.type(params.text, params.options, progress),
      "type",
    );
    return { typed: true };
  }

  async locatorSelectOption(params: LocatorSelectOptionParams): Promise<LocatorSelectOptionResult> {
    return await this.runLocator(
      "locator.select_option",
      params,
      (locator, progress) => locator.selectOption(params.values, progress),
      "selectOption",
    );
  }

  async locatorSetInputFiles(
    params: LocatorSetInputFilesParams,
  ): Promise<LocatorSetInputFilesResult> {
    await this.runLocator(
      "locator.set_input_files",
      params,
      (locator, progress) =>
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
      "setInputFiles",
    );
    return { set: true };
  }

  private runLocator<T>(
    name: string,
    params: LocatorParams,
    action: (locator: UnderstudyRuntimeLocator, progress: Progress) => Promise<T> | T,
    operation?: ApcLocatorOperation,
  ): Promise<T> {
    return runWithProgress(
      { name, timeout: params.options?.timeout ?? DEFAULT_LOCATOR_TIMEOUT_MS },
      async (progress) => {
        if (!hasPromptSelector(params.selector))
          return action(this.resolveLocator(params), progress);
        if (!operation)
          throw new UnsupportedPromptLocatorError(`Prompt selectors do not support ${name}`);
        this.promptOperations.add(progress);
        try {
          const target = await this.resolvePromptLocatorTarget(params, operation, progress);
          progress.throwIfStopped();
          if (!target) throw new PromptLocatorNoMatchError();
          const locator = new ChainTargetLocator(target, params.selector.steps.at(-1)!.selector);
          return await action(locator, progress);
        } finally {
          this.promptOperations.delete(progress);
        }
      },
    );
  }

  async close(): Promise<void> {
    this.cancelDecisions();
    await this.enqueueLifecycle(async () => {
      this.clearStagehandInstance();
      await this.disconnectBrowser();
      // A queued instance disposal still owns request admission.
      if (!this.stagehandInstanceDisposal) this.stagehandInstanceClosing = false;
    });
  }

  async disposeStagehandInstance(): Promise<void> {
    if (this.stagehandInstanceDisposal) return await this.stagehandInstanceDisposal;

    this.stagehandInstanceClosing = true;
    this.cancelDecisions();
    const disposal = this.enqueueLifecycle(async () => {
      // Pending registrations must release their request leases before disposal can drain them.
      this.disposeAllPageEventSubscriptions();
      await this.waitForStagehandInstanceRequests();
      // The browser connection can outlive the instance, but its policy must not.
      const session = this.browserSession;
      if (session?.getDomainPolicy()) await session.setDomainPolicy(null);
      await this.runPendingSessionCleanup();
      this.clearStagehandInstance();
      this.stagehandInstanceClosing = false;
    });
    this.stagehandInstanceDisposal = disposal.finally(() => {
      // Failed disposal has already removed subscriptions. Keep requests closed,
      // but release the promise so cleanup can be retried.
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

  private cancelDecisions(): void {
    for (const progress of this.promptOperations) {
      progress.abort(new Error("Stagehand prompt locator operation is no longer active"));
    }
    this.promptOperations.clear();
    for (const controller of this.decisionControllers) {
      controller.abort(new Error("Stagehand decision request is no longer active"));
    }
    this.decisionControllers.clear();
  }

  private clearStagehandInstance(): void {
    this.cancelDecisions();
    this.disposeAllPageEventSubscriptions();
    this.pagesById.clear();
    this.responseHandles.clear();
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
    assertDeterministicLocator(params.selector, "this locator operation");
    return this.resolvePage(params.pageId).deepLocator(params.selector);
  }

  async resolvePromptLocatorTarget(
    params: LocatorDescriptor,
    operation: ApcLocatorOperation,
    progress: Progress,
  ): Promise<ChainTarget | null> {
    const state = this.state.getState();
    if (state.status !== "initialized" || !state.initParams.decisionModel) {
      throw new DecisionModelNotConfiguredError();
    }
    const assertActive = () => {
      progress.throwIfStopped();
      if (this.stagehandInstanceClosing || this.state.getState() !== state) {
        throw new Error("Stagehand decision request is no longer active");
      }
    };
    assertActive();
    const target = await resolvePromptLocator(
      this.resolveUnderstudyPage(params.pageId),
      params.selector,
      operation,
      (request, parentProgress) => {
        assertActive();
        return this.chooseDecision(request, parentProgress);
      },
      progress,
    );
    assertActive();
    return target;
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
        this.disposePageEventSubscriptions(pageId);
        this.pagesById.delete(pageId);
        this.responseHandles.deleteForPage(pageId);
      }
    }
  }

  private disposePageEventSubscriptions(pageId: string, pendingOnly = false): void {
    for (const [subscriptionId, subscription] of this.pageEventSubscriptions) {
      if (subscription.pageId !== pageId) continue;
      if (pendingOnly && subscription.dispose) continue;
      this.pageOff({ subscriptionId });
    }
  }

  private disposeAllPageEventSubscriptions(): void {
    for (const subscriptionId of this.pageEventSubscriptions.keys())
      this.pageOff({ subscriptionId });
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

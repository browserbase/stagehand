import type {
  BrowserGetVersionResult,
  ContextNewPageParams,
  ContextPagesResult,
  LLMGenerateParams,
  LLMGenerateResult,
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
  LocatorSendClickEventParams,
  LocatorSendClickEventResult,
  LocatorTextContentResult,
  LocatorTypeParams,
  LocatorTypeResult,
  PageClickParams,
  PageCloseResult,
  PageCoordinateResult,
  PageAddInitScriptParams,
  PageDragAndDropParams,
  PageDragAndDropResult,
  PageEvaluateParams,
  PageEvaluateResult,
  PageGoBackParams,
  PageGoForwardParams,
  PageGotoParams,
  PageHoverParams,
  PageIdParams,
  PageKeyPressParams,
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
  RuntimeConfigureParams,
  RuntimeConfigureResult,
  RuntimeLoopbackStatusResult,
  StagehandInitParams,
  StagehandInitResult,
  SnapshotResult,
} from "../protocol/types.js";
import { bytesToBase64 } from "./understudy/fileUploadUtils.js";
import { createStore } from "zustand/vanilla";
import type { StagehandLogEmitter } from "./logger.js";
import { StagehandLogger } from "./logger.js";
import * as llmService from "./services/llmService.js";
import { StagehandRuntimeStateSchema, type StagehandRuntimeState } from "./runtimeState.js";
import { createStagehandTracing, type StagehandTracing } from "./tracing.js";

export type UnderstudyRuntimePage = {
  targetId(): string;
  url(): string;
  goto(url: string, options?: PageGotoParams["options"]): Promise<unknown>;
  reload(options?: PageReloadParams["options"]): Promise<unknown>;
  goBack(options?: PageGoBackParams["options"]): Promise<unknown>;
  goForward(options?: PageGoForwardParams["options"]): Promise<unknown>;
  click(x: number, y: number, options?: PageClickParams["options"]): Promise<string>;
  hover(x: number, y: number, options?: PageHoverParams["options"]): Promise<string>;
  scroll(
    x: number,
    y: number,
    deltaX: number,
    deltaY: number,
    options?: PageScrollParams["options"],
  ): Promise<string>;
  dragAndDrop(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    options?: PageDragAndDropParams["options"],
  ): Promise<[string, string]>;
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
  waitForLoadState(state: PageWaitForLoadStateParams["state"], timeoutMs?: number): Promise<void>;
  waitForTimeout(ms: number): Promise<void>;
  waitForSelector(
    selector: string,
    options?: PageWaitForSelectorParams["options"],
  ): Promise<boolean>;
  screenshot(options?: UnderstudyRuntimeScreenshotOptions): Promise<Uint8Array>;
  snapshot(options?: PageSnapshotOptions): Promise<SnapshotResult>;
  title(): Promise<string>;
  close(): Promise<void> | void;
  deepLocator(selector: string): UnderstudyRuntimeLocator;
};

export type UnderstudyRuntimeScreenshotOptions = Omit<PageScreenshotOptions, "mask"> & {
  mask?: UnderstudyRuntimeLocator[];
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
  nth(index: number): UnderstudyRuntimeLocator;
};

export type StagehandBrowserSession = {
  readonly connected: boolean;
  getVersion(): Promise<BrowserGetVersionResult>;
  pages(): UnderstudyRuntimePage[];
  newPage(url?: string): Promise<UnderstudyRuntimePage>;
  close(): Promise<void> | void;
};

export type StagehandBrowserSessionFactory = (
  cdpUrl: string,
  logger: StagehandLogger,
) => Promise<StagehandBrowserSession>;

export type StagehandRuntimeAdapters = {
  browserSessionFactory?: StagehandBrowserSessionFactory;
  emitLog?: StagehandLogEmitter;
  clientLLMGenerate?: (params: LLMGenerateParams) => Promise<LLMGenerateResult>;
};

type ResolvedStagehandRuntimeAdapters = Required<StagehandRuntimeAdapters>;

const defaultBrowserSessionFactory: StagehandBrowserSessionFactory = async () => {
  throw new Error("Stagehand browser session factory is not configured");
};
const discardLog: StagehandLogEmitter = () => {};
const unavailableClientLLM = async (): Promise<never> => {
  throw new Error("The connected SDK did not register a client-side LLM");
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
    },
    tracing,
  );
}

export class StagehandRuntime {
  readonly logger: StagehandLogger;
  readonly state = createStore<StagehandRuntimeState>()(() =>
    StagehandRuntimeStateSchema.parse({ status: "created" }),
  );
  browserSession?: StagehandBrowserSession;
  pagesById = new Map<string, UnderstudyRuntimePage>();

  constructor(
    readonly adapters: ResolvedStagehandRuntimeAdapters,
    readonly tracing: StagehandTracing,
  ) {
    this.logger = new StagehandLogger(tracing, adapters.emitLog);
  }

  loopbackStatus(): RuntimeLoopbackStatusResult {
    return {
      configured: this.browserSession !== undefined,
      connected: this.browserSession?.connected ?? false,
    };
  }

  async configureLoopback(params: RuntimeConfigureParams): Promise<RuntimeConfigureResult> {
    const { cdpUrl } = params;
    const previousSession = this.browserSession;
    this.browserSession = undefined;
    this.pagesById.clear();
    await previousSession?.close();

    try {
      this.browserSession = await this.adapters.browserSessionFactory(cdpUrl, this.logger);
    } catch (error) {
      await this.browserSession?.close();
      this.browserSession = undefined;
      throw error;
    }

    return { configured: true };
  }

  async initialize(params: StagehandInitParams): Promise<StagehandInitResult> {
    if (this.state.getState().status !== "created") {
      throw new Error("Stagehand has already been initialized");
    }

    const pages = await this.contextPages();
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
  }

  async browserGetVersion(): Promise<BrowserGetVersionResult> {
    return await this.requireBrowserSession().getVersion();
  }

  async generateLlm(input: LLMGenerateParams): Promise<LLMGenerateResult> {
    const state = this.state.getState();
    const model = state.status === "initialized" ? state.initParams.model : undefined;
    if (!model || !("source" in model)) {
      throw new Error("A client-side LLM was not configured during Stagehand initialization");
    }

    return await llmService.generate(
      { source: "client", request: this.adapters.clientLLMGenerate },
      input,
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

  async pageGoto(params: PageGotoParams): Promise<PageRef> {
    const page = this.resolvePage(params.pageId);
    await page.goto(params.url, params.options);
    return pageRefFromUnderstudyPage(page);
  }

  async pageReload(params: PageReloadParams): Promise<PageRef> {
    const page = this.resolvePage(params.pageId);
    await page.reload(params.options);
    return pageRefFromUnderstudyPage(page);
  }

  async pageGoBack(params: PageGoBackParams): Promise<PageRef> {
    const page = this.resolvePage(params.pageId);
    await page.goBack(params.options);
    return pageRefFromUnderstudyPage(page);
  }

  async pageGoForward(params: PageGoForwardParams): Promise<PageRef> {
    const page = this.resolvePage(params.pageId);
    await page.goForward(params.options);
    return pageRefFromUnderstudyPage(page);
  }

  async pageClick(params: PageClickParams): Promise<PageCoordinateResult> {
    const { pageId, x, y, options } = params;
    return { xpath: await this.resolvePage(pageId).click(x, y, options) };
  }

  async pageHover(params: PageHoverParams): Promise<PageCoordinateResult> {
    const { pageId, x, y, options } = params;
    return { xpath: await this.resolvePage(pageId).hover(x, y, options) };
  }

  async pageScroll(params: PageScrollParams): Promise<PageCoordinateResult> {
    const { pageId, x, y, deltaX, deltaY, options } = params;
    return {
      xpath: await this.resolvePage(pageId).scroll(x, y, deltaX, deltaY, options),
    };
  }

  async pageDragAndDrop(params: PageDragAndDropParams): Promise<PageDragAndDropResult> {
    const { pageId, fromX, fromY, toX, toY, options } = params;
    const [fromXpath, toXpath] = await this.resolvePage(pageId).dragAndDrop(
      fromX,
      fromY,
      toX,
      toY,
      options,
    );
    return { fromXpath, toXpath };
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
    await this.resolvePage(params.pageId).waitForLoadState(params.state, params.timeoutMs);
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

  pageUrl(params: PageIdParams): PageUrlResult {
    return {
      url: this.resolvePage(params.pageId).url(),
    };
  }

  async pageTitle(params: PageIdParams): Promise<PageTitleResult> {
    return {
      title: await this.resolvePage(params.pageId).title(),
    };
  }

  async pageClose(params: PageIdParams): Promise<PageCloseResult> {
    const page = this.resolvePage(params.pageId);
    await page.close();
    this.pagesById.delete(params.pageId);
    return { closed: true };
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
    return {
      count: await this.resolveLocator(params).count(),
    };
  }

  async locatorIsChecked(params: LocatorDescriptor): Promise<LocatorIsCheckedResult> {
    return {
      checked: await this.resolveLocator(params).isChecked(),
    };
  }

  async locatorInputValue(params: LocatorDescriptor): Promise<LocatorInputValueResult> {
    return {
      value: await this.resolveLocator(params).inputValue(),
    };
  }

  async locatorIsVisible(params: LocatorDescriptor): Promise<LocatorIsVisibleResult> {
    return {
      visible: await this.resolveLocator(params).isVisible(),
    };
  }

  async locatorInnerText(params: LocatorDescriptor): Promise<LocatorInnerTextResult> {
    return {
      text: await this.resolveLocator(params).innerText(),
    };
  }

  async locatorInnerHtml(params: LocatorDescriptor): Promise<LocatorInnerHtmlResult> {
    return {
      html: await this.resolveLocator(params).innerHtml(),
    };
  }

  async locatorTextContent(params: LocatorDescriptor): Promise<LocatorTextContentResult> {
    return {
      textContent: await this.resolveLocator(params).textContent(),
    };
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
    return {
      values: await this.resolveLocator(params).selectOption(params.values),
    };
  }

  async close(): Promise<void> {
    const session = this.browserSession;
    this.browserSession = undefined;
    this.pagesById.clear();
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

  resolveLocator(params: LocatorDescriptor): UnderstudyRuntimeLocator {
    const locator = this.resolvePage(params.pageId).deepLocator(params.selector);
    return params.nth === undefined ? locator : locator.nth(params.nth);
  }

  refreshPageRegistry(pages: UnderstudyRuntimePage[]): void {
    const currentPageIds = new Set<string>();

    for (const page of pages) {
      const pageId = this.registerPage(page);
      currentPageIds.add(pageId);
    }

    for (const pageId of this.pagesById.keys()) {
      if (!currentPageIds.has(pageId)) this.pagesById.delete(pageId);
    }
  }

  registerPage(page: UnderstudyRuntimePage): string {
    const pageId = page.targetId();
    this.pagesById.set(pageId, page);
    return pageId;
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

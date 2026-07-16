import type {
  BrowserGetVersionResult,
  ContextNewPageParams,
  ContextPagesResult,
  LLMGenerateParams,
  LLMGenerateResult,
  LocatorClickParams,
  LocatorClickResult,
  LocatorCentroidParams,
  LocatorCentroidResult,
  LocatorCountParams,
  LocatorCountResult,
  LocatorDescriptor,
  LocatorFillParams,
  LocatorFillResult,
  LocatorHighlightParams,
  LocatorHighlightResult,
  LocatorHoverParams,
  LocatorHoverResult,
  LocatorInnerHtmlParams,
  LocatorInnerHtmlResult,
  LocatorInnerTextParams,
  LocatorInnerTextResult,
  LocatorInputValueParams,
  LocatorInputValueResult,
  LocatorIsCheckedParams,
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
  PageCloseResult,
  PageGotoParams,
  PageIdParams,
  PageRef,
  PageTitleResult,
  PageUrlResult,
  RuntimeConfigureParams,
  RuntimeConfigureResult,
  RuntimeLoopbackStatusResult,
  StagehandInitParams,
  StagehandInitResult,
} from "../protocol/types.js";
import type { StagehandLogEmitter } from "./logger.js";
import { StagehandLogger } from "./logger.js";
import { RemoteLLMClient } from "./llm/remoteLlmClient.js";
import { createStagehandTracing, type StagehandTracing } from "./tracing.js";

export type UnderstudyRuntimePage = {
  targetId(): string;
  url(): string;
  goto(url: string, options?: PageGotoParams["options"]): Promise<unknown>;
  title(): Promise<string>;
  close(): Promise<void> | void;
  deepLocator(selector: string): UnderstudyRuntimeLocator;
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
  browserSession?: StagehandBrowserSession;
  clientLLM?: RemoteLLMClient;
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
    this.clientLLM =
      params.model && "source" in params.model
        ? new RemoteLLMClient(params.model.modelName, this.adapters.clientLLMGenerate)
        : undefined;

    return {
      initialized: true,
      pages: await this.contextPages(),
    };
  }

  async browserGetVersion(): Promise<BrowserGetVersionResult> {
    return await this.requireBrowserSession().getVersion();
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

  async locatorHover(params: LocatorHoverParams): Promise<LocatorHoverResult> {
    await this.resolveLocator(params).hover();
    return { hovered: true };
  }

  async locatorFill(params: LocatorFillParams): Promise<LocatorFillResult> {
    await this.resolveLocator(params).fill(params.value);
    return { filled: true };
  }

  async locatorCount(params: LocatorCountParams): Promise<LocatorCountResult> {
    return {
      count: await this.resolveLocator(params).count(),
    };
  }

  async locatorIsChecked(params: LocatorIsCheckedParams): Promise<LocatorIsCheckedResult> {
    return {
      checked: await this.resolveLocator(params).isChecked(),
    };
  }

  async locatorInputValue(params: LocatorInputValueParams): Promise<LocatorInputValueResult> {
    return {
      value: await this.resolveLocator(params).inputValue(),
    };
  }

  async locatorIsVisible(params: LocatorDescriptor): Promise<LocatorIsVisibleResult> {
    return {
      visible: await this.resolveLocator(params).isVisible(),
    };
  }

  async locatorInnerText(params: LocatorInnerTextParams): Promise<LocatorInnerTextResult> {
    return {
      text: await this.resolveLocator(params).innerText(),
    };
  }

  async locatorInnerHtml(params: LocatorInnerHtmlParams): Promise<LocatorInnerHtmlResult> {
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

  async locatorCentroid(params: LocatorCentroidParams): Promise<LocatorCentroidResult> {
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
    await session?.close();
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

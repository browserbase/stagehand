import type {
  BrowserGetVersionResult,
  ContextNewPageParams,
  ContextPagesResult,
  PageCloseResult,
  PageGotoParams,
  PageIdParams,
  PageRef,
  PageTitleResult,
  PageUrlResult,
  RuntimeConfigureParams,
  RuntimeConfigureResult,
  RuntimeLoopbackStatusResult,
} from "../../protocol/types.js";

type JsonObject = Record<string, unknown>;

export type LoopbackCdpConnection = {
  readonly connected: boolean;
  send<Result = JsonObject>(method: string, params?: JsonObject): Promise<Result>;
  close(): void;
};

export type LoopbackCdpConnectionFactory = (cdpUrl: string) => Promise<LoopbackCdpConnection>;

export type UnderstudyRuntimePage = {
  targetId(): string;
  url(): string;
  goto(url: string, options?: PageGotoParams["options"]): Promise<unknown>;
  title(): Promise<string>;
  close(): Promise<void> | void;
};

export type UnderstudyRuntimeContext = {
  pages(): UnderstudyRuntimePage[];
  newPage(url?: string): Promise<UnderstudyRuntimePage>;
  close(): Promise<void> | void;
};

export type UnderstudyRuntimeContextFactory = (cdpUrl: string) => Promise<UnderstudyRuntimeContext>;

export type StagehandRuntimeDependencies = {
  loopbackCdpFactory?: LoopbackCdpConnectionFactory;
  understudyContextFactory?: UnderstudyRuntimeContextFactory;
};

type ResolvedStagehandRuntimeDependencies = Required<StagehandRuntimeDependencies>;

const defaultLoopbackCdpFactory: LoopbackCdpConnectionFactory = async () => {
  throw new Error("Stagehand loopback CDP factory is not configured");
};
const defaultUnderstudyContextFactory: UnderstudyRuntimeContextFactory = async () => {
  throw new Error("Stagehand understudy context factory is not configured");
};

export function createStagehandRuntimeService(
  dependencies: StagehandRuntimeDependencies = {},
): StagehandRuntimeService {
  return new StagehandRuntimeService({
    loopbackCdpFactory: dependencies.loopbackCdpFactory ?? defaultLoopbackCdpFactory,
    understudyContextFactory:
      dependencies.understudyContextFactory ?? defaultUnderstudyContextFactory,
  });
}

export class StagehandRuntimeService {
  #loopback?: LoopbackCdpConnection;
  #understudyContext?: UnderstudyRuntimeContext;
  #pagesById = new Map<string, UnderstudyRuntimePage>();

  constructor(private readonly dependencies: ResolvedStagehandRuntimeDependencies) {}

  loopbackStatus(): RuntimeLoopbackStatusResult {
    return {
      configured: this.#loopback !== undefined,
      connected: this.#loopback?.connected ?? false,
    };
  }

  async configureLoopback(params: RuntimeConfigureParams): Promise<RuntimeConfigureResult> {
    const { cdpUrl } = params;
    const previousLoopback = this.#loopback;
    this.#loopback = undefined;
    previousLoopback?.close();

    const previousContext = this.#understudyContext;
    this.#understudyContext = undefined;
    this.#pagesById.clear();
    await previousContext?.close();

    try {
      this.#loopback = await this.dependencies.loopbackCdpFactory(cdpUrl);
      this.#understudyContext = await this.dependencies.understudyContextFactory(cdpUrl);
    } catch (error) {
      this.#loopback?.close();
      this.#loopback = undefined;
      this.#understudyContext = undefined;
      throw new StagehandRuntimeError(
        `Failed to configure Stagehand loopback CDP: ${errorMessage(error)}`,
        -32002,
        "stagehand.loopback_configure_failed",
      );
    }

    return { configured: true };
  }

  async browserGetVersion(): Promise<BrowserGetVersionResult> {
    return await this.requireLoopback().send<BrowserGetVersionResult>("Browser.getVersion");
  }

  async contextPages(): Promise<ContextPagesResult> {
    const pages = this.requireUnderstudyContext().pages();
    this.refreshPageRegistry(pages);
    return pages.map((page) => this.pageRefForId(page.targetId()));
  }

  async contextNewPage(params: ContextNewPageParams): Promise<PageRef> {
    const page = await this.requireUnderstudyContext().newPage(params.url);
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
    this.#pagesById.delete(params.pageId);
    return { closed: true };
  }

  async close(): Promise<void> {
    const loopback = this.#loopback;
    this.#loopback = undefined;
    loopback?.close();

    const context = this.#understudyContext;
    this.#understudyContext = undefined;
    this.#pagesById.clear();
    await context?.close();
  }

  private pageRefForId(pageId: string): PageRef {
    return pageRefFromUnderstudyPage(this.resolvePage(pageId));
  }

  private resolvePage(pageId: string): UnderstudyRuntimePage {
    const cachedPage = this.#pagesById.get(pageId);
    if (cachedPage) return cachedPage;

    this.refreshPageRegistry(this.requireUnderstudyContext().pages());
    const refreshedPage = this.#pagesById.get(pageId);
    if (refreshedPage) return refreshedPage;

    throw new StagehandRuntimeError(
      `Stagehand page "${pageId}" was not found; call context.pages and retry`,
      -32602,
      "stagehand.page_not_found",
    );
  }

  private refreshPageRegistry(pages: UnderstudyRuntimePage[]): void {
    const currentPageIds = new Set<string>();

    for (const page of pages) {
      const pageId = this.registerPage(page);
      currentPageIds.add(pageId);
    }

    for (const pageId of this.#pagesById.keys()) {
      if (!currentPageIds.has(pageId)) this.#pagesById.delete(pageId);
    }
  }

  private registerPage(page: UnderstudyRuntimePage): string {
    const pageId = page.targetId();
    this.#pagesById.set(pageId, page);
    return pageId;
  }

  private requireLoopback(): LoopbackCdpConnection {
    if (!this.#loopback) {
      throw new StagehandRuntimeError(
        "Stagehand loopback CDP is not configured",
        -32000,
        "stagehand.loopback_not_configured",
      );
    }

    if (!this.#loopback.connected) {
      throw new StagehandRuntimeError(
        "Stagehand loopback CDP is disconnected",
        -32001,
        "stagehand.loopback_disconnected",
      );
    }

    return this.#loopback;
  }

  private requireUnderstudyContext(): UnderstudyRuntimeContext {
    if (!this.#understudyContext) {
      throw new StagehandRuntimeError(
        "Stagehand loopback CDP is not configured",
        -32000,
        "stagehand.loopback_not_configured",
      );
    }

    return this.#understudyContext;
  }
}

export class StagehandRuntimeError extends Error {
  constructor(
    message: string,
    readonly code: number,
    readonly type: string,
  ) {
    super(message);
    this.name = "StagehandRuntimeError";
  }
}

function pageRefFromUnderstudyPage(page: UnderstudyRuntimePage): PageRef {
  return {
    pageId: page.targetId(),
    url: page.url(),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

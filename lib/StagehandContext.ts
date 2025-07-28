import type {
  BrowserContext as PlaywrightContext,
  CDPSession,
  Page as PlaywrightPage,
} from "playwright";
import { Stagehand } from "./index";
import { StagehandPage } from "./StagehandPage";
import { Page } from "../types/page";
import { EnhancedContext } from "../types/context";
import { Protocol } from "devtools-protocol";

export class StagehandContext {
  private readonly stagehand: Stagehand;
  private readonly intContext: EnhancedContext;
  private pageMap: WeakMap<PlaywrightPage, StagehandPage>;
  private activeStagehandPage: StagehandPage | null = null;
  private readonly frameIdMap: Map<string, StagehandPage> = new Map();

  private constructor(context: PlaywrightContext, stagehand: Stagehand) {
    this.stagehand = stagehand;
    this.pageMap = new WeakMap();

    // Create proxy around the context
    this.intContext = new Proxy(context, {
      get: (target, prop) => {
        if (prop === "newPage") {
          return async (): Promise<Page> => {
            const pwPage = await target.newPage();
            const stagehandPage = await this.createStagehandPage(pwPage);
            await this.attachFrameNavigatedListener(pwPage);
            // Set as active page when created
            this.setActivePage(stagehandPage);
            return stagehandPage.page;
          };
        }
        if (prop === "pages") {
          return (): Page[] => {
            const pwPages = target.pages();
            // Convert all pages to StagehandPages synchronously
            return pwPages.map((pwPage: PlaywrightPage) => {
              let stagehandPage = this.pageMap.get(pwPage);
              if (!stagehandPage) {
                // Create a new StagehandPage and store it in the map
                stagehandPage = new StagehandPage(
                  pwPage,
                  this.stagehand,
                  this,
                  this.stagehand.llmClient,
                  this.stagehand.userProvidedInstructions,
                  this.stagehand.apiClient,
                  this.stagehand.waitForCaptchaSolves,
                );
                this.pageMap.set(pwPage, stagehandPage);
              }
              return stagehandPage.page;
            });
          };
        }
        return target[prop as keyof PlaywrightContext];
      },
    }) as unknown as EnhancedContext;
  }

  private async createStagehandPage(
    page: PlaywrightPage,
  ): Promise<StagehandPage> {
    const stagehandPage = await new StagehandPage(
      page,
      this.stagehand,
      this,
      this.stagehand.llmClient,
      this.stagehand.userProvidedInstructions,
      this.stagehand.apiClient,
      this.stagehand.waitForCaptchaSolves,
    ).init();
    this.pageMap.set(page, stagehandPage);
    return stagehandPage;
  }

  static async init(
    context: PlaywrightContext,
    stagehand: Stagehand,
  ): Promise<StagehandContext> {
    const instance = new StagehandContext(context, stagehand);
    context.on("page", async (pwPage) => {
      await instance.handleNewPlaywrightPage(pwPage);
      instance
        .attachFrameNavigatedListener(pwPage)
        .catch((err) =>
          stagehand.logger({
            category: "cdp",
            message: `Failed to attach frameNavigated listener: ${err}`,
            level: 0,
          }),
        )
        .finally(() =>
          instance.handleNewPlaywrightPage(pwPage).catch((err) =>
            stagehand.logger({
              category: "context",
              message: `Failed to initialise new page: ${err}`,
              level: 0,
            }),
          ),
        );
    });

    // Initialize existing pages
    const existingPages = context.pages();
    for (const page of existingPages) {
      const stagehandPage = await instance.createStagehandPage(page);
      await instance.attachFrameNavigatedListener(page);
      // Set the first page as active
      if (!instance.activeStagehandPage) {
        instance.setActivePage(stagehandPage);
      }
    }

    return instance;
  }
  public get frameIdLookup(): ReadonlyMap<string, StagehandPage> {
    return this.frameIdMap;
  }

  public registerFrameId(frameId: string, page: StagehandPage): void {
    this.frameIdMap.set(frameId, page);
  }

  public unregisterFrameId(frameId: string): void {
    this.frameIdMap.delete(frameId);
  }

  public getStagehandPageByFrameId(frameId: string): StagehandPage | undefined {
    return this.frameIdMap.get(frameId);
  }

  public get context(): EnhancedContext {
    return this.intContext;
  }

  public async getStagehandPage(page: PlaywrightPage): Promise<StagehandPage> {
    let stagehandPage = this.pageMap.get(page);
    if (!stagehandPage) {
      stagehandPage = await this.createStagehandPage(page);
    }
    // Update active page when getting a page
    this.setActivePage(stagehandPage);
    return stagehandPage;
  }

  public async getStagehandPages(): Promise<StagehandPage[]> {
    const pwPages = this.intContext.pages();
    return Promise.all(
      pwPages.map((page: PlaywrightPage) => this.getStagehandPage(page)),
    );
  }

  public setActivePage(page: StagehandPage): void {
    this.activeStagehandPage = page;
    // Update the stagehand's active page reference
    this.stagehand["setActivePage"](page);
  }

  public getActivePage(): StagehandPage | null {
    return this.activeStagehandPage;
  }

  private async handleNewPlaywrightPage(pwPage: PlaywrightPage): Promise<void> {
    let stagehandPage = this.pageMap.get(pwPage);
    if (!stagehandPage) {
      stagehandPage = await this.createStagehandPage(pwPage);
    }
    this.setActivePage(stagehandPage);
  }

  private async attachFrameNavigatedListener(
    pwPage: PlaywrightPage,
  ): Promise<void> {
    const shPage = this.pageMap.get(pwPage);
    if (!shPage) return;
    const session: CDPSession = await this.intContext.newCDPSession(pwPage);
    await session.send("Page.enable");

    pwPage.once("close", () => {
      if (shPage.frameId) this.unregisterFrameId(shPage.frameId);
    });

    session.on(
      "Page.frameNavigated",
      (evt: Protocol.Page.FrameNavigatedEvent): void => {
        if (evt.frame.parentId) return;
        if (evt.frame.id === shPage.frameId) return;

        const oldId = shPage.frameId;
        if (oldId) this.unregisterFrameId(oldId);
        this.registerFrameId(evt.frame.id, shPage);
        shPage.updateRootFrameId(evt.frame.id);
      },
    );
  }
}

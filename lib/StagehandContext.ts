import type {
  BrowserContext as PuppeteerContext,
  Page as PuppeteerPage,
} from "puppeteer-core";
import { Stagehand } from "./index";
import { StagehandPage } from "./StagehandPage";
import { Page as StagehandAugmentedPage } from "../types/page";
import { EnhancedContext } from "../types/context";

export class StagehandContext {
  private readonly stagehand: Stagehand;
  private readonly intContext: EnhancedContext;
  private pageMap: WeakMap<PuppeteerPage, StagehandPage>;
  private activeStagehandPage: StagehandPage | null = null;

  private constructor(
    context: PuppeteerContext | EnhancedContext,
    stagehand: Stagehand,
  ) {
    this.stagehand = stagehand;
    this.pageMap = new WeakMap();

    // Create proxy around the context
    this.intContext = new Proxy(context, {
      get: (target: PuppeteerContext, prop) => {
        if (prop === "newPage") {
          return async (): Promise<StagehandAugmentedPage> => {
            const pwPage = await target.newPage();
            const stagehandPage = await this.createStagehandPage(pwPage);
            // Set as active page when created
            this.setActivePage(stagehandPage);
            return stagehandPage.page;
          };
        }
        if (prop === "pages") {
          return async (): Promise<StagehandAugmentedPage[]> => {
            const pwPages = await target.pages();
            // Convert all pages to StagehandPages synchronously
            return pwPages.map((pwPage: PuppeteerPage) => {
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
        return target[prop as keyof PuppeteerContext];
      },
    }) as unknown as EnhancedContext;
  }

  private async createStagehandPage(
    page: PuppeteerPage,
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
    context: EnhancedContext | PuppeteerContext,
    stagehand: Stagehand,
  ): Promise<StagehandContext> {
    const instance = new StagehandContext(context, stagehand);

    // Initialize existing pages
    const existingPages = (await context.pages()) as unknown as PuppeteerPage[];
    for (const page of existingPages) {
      const stagehandPage = await instance.createStagehandPage(page);
      // Set the first page as active
      if (!instance.activeStagehandPage) {
        instance.setActivePage(stagehandPage);
      }
    }

    return instance;
  }

  public get context(): EnhancedContext {
    return this.intContext;
  }

  public async getStagehandPage(page: PuppeteerPage): Promise<StagehandPage> {
    let stagehandPage = this.pageMap.get(page);
    if (!stagehandPage) {
      stagehandPage = await this.createStagehandPage(page);
    }
    // Update active page when getting a page
    this.setActivePage(stagehandPage);
    return stagehandPage;
  }

  public async getStagehandPages(): Promise<StagehandPage[]> {
    const pwPages =
      (await this.intContext.pages()) as unknown as PuppeteerPage[];
    return Promise.all(
      pwPages.map(
        async (page: PuppeteerPage) => await this.getStagehandPage(page),
      ),
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
}

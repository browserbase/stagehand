import type {
  BrowserContext as PlaywrightContext,
  Page as PlaywrightPage,
} from "@playwright/test";
import { Stagehand } from "./index";
import { StagehandPage } from "./StagehandPage";
import { Page } from "../types/page";
import { EnhancedContext } from "../types/context";

export class StagehandContext {
  private readonly stagehand: Stagehand;
  private readonly intContext: EnhancedContext;
  private pageMap: WeakMap<PlaywrightPage, StagehandPage>;
  private activeStagehandPage: StagehandPage | null = null;

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
            // Set as active page when created
            this.setActivePage(stagehandPage);
            return stagehandPage.page;
          };
        }
        if (prop === "pages") {
          return (): Page[] => {
            const pwPages = target.pages();
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
        // For other properties/methods, pass through to the original context
        return target[prop as keyof PlaywrightContext];
      },
    }) as unknown as EnhancedContext;

    // Listen for new pages directly on the original Playwright context
    context.on("page", async (newPage: PlaywrightPage) => {
      try {
        // Check if we already have this page wrapped and initialized
        let stagehandPage = this.pageMap.get(newPage);
        if (
          stagehandPage &&
          (stagehandPage as unknown as { initialized: boolean }).initialized
        ) {
          this.setActivePage(stagehandPage);
          return;
        }

        stagehandPage = await this.createStagehandPage(newPage); // This calls .init()
        this.setActivePage(stagehandPage);

        this.stagehand.log({
          category: "context",
          message: "New page wrapped and set as active by direct listener.",
          level: 1,
        });
      } catch (error) {
        this.stagehand.log({
          category: "context",
          message: "Error in direct 'page' event listener",
          level: 0, // Error level
          auxiliary: {
            error: { value: error.message, type: "string" },
            trace: { value: error.stack, type: "string" },
          },
        });
      }
    });
  }

  private async createStagehandPage(
    page: PlaywrightPage,
  ): Promise<StagehandPage> {
    if (this.pageMap.has(page)) {
      const existingPage = this.pageMap.get(page);
      return existingPage;
    }

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

    // Initialize existing pages
    const existingPages = context.pages();
    if (existingPages.length === 0) {
      // If no pages exist, create one (Playwright context might start empty)
      stagehand.log({
        category: "context",
        message: "No existing pages, creating a new one.",
        level: 2,
      });
      const pwPage = await context.newPage();
      const shPage = await instance.createStagehandPage(pwPage);
      instance.setActivePage(shPage);
    } else {
      for (const page of existingPages) {
        const stagehandPage = await instance.createStagehandPage(page);
        if (!instance.activeStagehandPage) {
          instance.setActivePage(stagehandPage); // Set first page as active
        }
      }
    }
    return instance;
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
}

import type {
  BrowserContext as PlaywrightContext,
  Page as PlaywrightPage,
} from "@playwright/test";
import { Stagehand } from "./index";
import { StagehandPage } from "./StagehandPage";
import { Page } from "../types/page";

// Define the enhanced context type that includes our modified methods
export interface EnhancedContext
  extends Omit<PlaywrightContext, "newPage" | "pages"> {
  newPage(): Promise<Page>;
  pages(): Page[];
}

export class StagehandContext {
  private readonly stagehand: Stagehand;
  private readonly intContext: EnhancedContext;
  private pageMap: WeakMap<PlaywrightPage, StagehandPage>;

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
                  this.stagehand.getLLMClient(),
                  this.stagehand.getSystemPrompt(),
                  this.stagehand.getAPIClient(),
                  this.stagehand.getWaitForCaptchaSolves(),
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
      this.stagehand.getLLMClient(),
      this.stagehand.getSystemPrompt(),
      this.stagehand.getAPIClient(),
      this.stagehand.getWaitForCaptchaSolves(),
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
    for (const page of existingPages) {
      await instance.createStagehandPage(page);
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
    return stagehandPage;
  }

  public async getStagehandPages(): Promise<StagehandPage[]> {
    const pwPages = this.intContext.pages();
    return Promise.all(
      pwPages.map((page: PlaywrightPage) => this.getStagehandPage(page)),
    );
  }
}

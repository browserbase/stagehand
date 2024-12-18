import type { Page as PlaywrightPage } from "@playwright/test";
import { Stagehand } from "./index";

export class StagehandPage {
  private stagehand: Stagehand;
  private intPage: PlaywrightPage;

  private constructor(page: PlaywrightPage, stagehand: Stagehand) {
    this.intPage = page;
    this.stagehand = stagehand;
  }

  static async init(
    page: PlaywrightPage,
    stagehand: Stagehand,
  ): Promise<StagehandPage> {
    const proxyPage = new Proxy(page, {
      get: (target, prop) => {
        console.log("FROM PROXY", prop);
        return target[prop as keyof PlaywrightPage];
      },
    });
    return new StagehandPage(proxyPage, stagehand);
  }

  public get page(): PlaywrightPage {
    return this.intPage;
  }
}

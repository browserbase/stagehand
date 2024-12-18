import type { Page as PlaywrightPage } from "@playwright/test";
import { GotoOptions, Stagehand } from "./index";

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

        // Override the goto method to add debugDom and waitForSettledDom
        if (prop === "goto")
          return async (url: string, options: GotoOptions) => {
            const result = await page.goto(url, options);
            if (stagehand.debugDom) {
              await page.evaluate(
                () => (window.showChunks = stagehand.debugDom),
              );
            }
            await page.waitForLoadState("domcontentloaded");
            await instance._waitForSettledDom();
            return result;
          };

        return target[prop as keyof PlaywrightPage];
      },
    });
    const instance = new StagehandPage(proxyPage, stagehand);
    await instance._waitForSettledDom();
    return instance;
  }

  public get page(): PlaywrightPage {
    return this.intPage;
  }

  // We can make methods public because StagehandPage is private to the Stagehand class.
  // When a user gets stagehand.page, they are getting a proxy to the Playwright page.
  // We can override the methods on the proxy to add our own behavior
  public async _waitForSettledDom(timeoutMs?: number) {
    try {
      const timeout = timeoutMs ?? this.stagehand.domSettleTimeoutMs;
      let timeoutHandle: NodeJS.Timeout;

      await this.page.waitForLoadState("domcontentloaded");

      const timeoutPromise = new Promise<void>((resolve) => {
        timeoutHandle = setTimeout(() => {
          this.stagehand.log({
            category: "dom",
            message: "DOM settle timeout exceeded, continuing anyway",
            level: 1,
            auxiliary: {
              timeout_ms: {
                value: timeout.toString(),
                type: "integer",
              },
            },
          });
          resolve();
        }, timeout);
      });

      try {
        await Promise.race([
          this.page.evaluate(() => {
            return new Promise<void>((resolve) => {
              if (typeof window.waitForDomSettle === "function") {
                window.waitForDomSettle().then(resolve);
              } else {
                console.warn(
                  "waitForDomSettle is not defined, considering DOM as settled",
                );
                resolve();
              }
            });
          }),
          this.page.waitForLoadState("domcontentloaded"),
          this.page.waitForSelector("body"),
          timeoutPromise,
        ]);
      } finally {
        clearTimeout(timeoutHandle!);
      }
    } catch (e) {
      this.stagehand.log({
        category: "dom",
        message: "Error in waitForSettledDom",
        level: 1,
        auxiliary: {
          error: {
            value: e.message,
            type: "string",
          },
          trace: {
            value: e.stack,
            type: "string",
          },
        },
      });
    }
  }

  public async startDomDebug() {
    try {
      await this.page
        .evaluate(() => {
          if (typeof window.debugDom === "function") {
            window.debugDom();
          } else {
            this.stagehand.log({
              category: "dom",
              message: "debugDom is not defined",
              level: 1,
            });
          }
        })
        .catch(() => {});
    } catch (e) {
      this.stagehand.log({
        category: "dom",
        message: "Error in startDomDebug",
        level: 1,
        auxiliary: {
          error: {
            value: e.message,
            type: "string",
          },
          trace: {
            value: e.stack,
            type: "string",
          },
        },
      });
    }
  }

  public async cleanupDomDebug() {
    if (this.stagehand.debugDom) {
      await this.page.evaluate(() => window.cleanupDebug()).catch(() => {});
    }
  }
}

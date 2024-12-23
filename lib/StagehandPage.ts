import type {
  Page as PlaywrightPage,
  BrowserContext as PlaywrightContext,
} from "@playwright/test";
import { LLMClient } from "./llm/LLMClient";
import { ActOptions, ActResult, GotoOptions, Stagehand } from "./index";
import { StagehandActHandler } from "./handlers/actHandler";
import { StagehandContext } from "./StagehandContext";
import { Page } from "../types/page";

export class StagehandPage {
  private stagehand: Stagehand;
  private intPage: Page;
  private intContext: StagehandContext;
  private actHandler: StagehandActHandler;
  private llmClient: LLMClient;

  constructor(
    page: PlaywrightPage,
    stagehand: Stagehand,
    context: StagehandContext,
    llmClient: LLMClient,
  ) {
    this.intPage = Object.assign(page, {
      act: () => {
        throw new Error("act() is not implemented on the base page object");
      },
    });
    this.stagehand = stagehand;
    this.intContext = context;
    this.actHandler = new StagehandActHandler({
      verbose: this.stagehand.verbose,
      llmProvider: this.stagehand.llmProvider,
      enableCaching: this.stagehand.enableCaching,
      logger: this.stagehand.logger,
      stagehandPage: this,
      stagehandContext: this.intContext,
      llmClient: llmClient,
    });
    this.llmClient = llmClient;
  }

  async init(): Promise<StagehandPage> {
    const page = this.intPage;
    const stagehand = this.stagehand;
    this.intPage = new Proxy(page, {
      get: (target, prop) => {
        // Override the goto method to add debugDom and waitForSettledDom
        if (prop === "goto")
          return async (url: string, options: GotoOptions) => {
            const result = await page.goto(url, options);
            if (stagehand.debugDom) {
              await page.evaluate(
                (debugDom) => (window.showChunks = debugDom),
                stagehand.debugDom,
              );
            }
            await this.intPage.waitForLoadState("domcontentloaded");
            await this._waitForSettledDom();
            return result;
          };

        if (prop === "act") {
          return async (options: ActOptions) => {
            return this.act(options);
          };
        }

        return target[prop as keyof PlaywrightPage];
      },
    });
    await this._waitForSettledDom();
    return this;
  }

  public get page(): Page {
    return this.intPage;
  }

  public get context(): PlaywrightContext {
    return this.intContext.context;
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
    if (this.stagehand.debugDom) {
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
  }

  public async cleanupDomDebug() {
    if (this.stagehand.debugDom) {
      await this.page.evaluate(() => window.cleanupDebug()).catch(() => {});
    }
  }

  async act({
    action,
    modelName,
    modelClientOptions,
    useVision = "fallback",
    variables = {},
    domSettleTimeoutMs,
  }: ActOptions): Promise<ActResult> {
    if (!this.actHandler) {
      throw new Error("Act handler not initialized");
    }

    useVision = useVision ?? "fallback";
    const requestId = Math.random().toString(36).substring(2);
    const llmClient: LLMClient = modelName
      ? this.stagehand.llmProvider.getClient(modelName, modelClientOptions)
      : this.llmClient;

    this.stagehand.log({
      category: "act",
      message: "running act",
      level: 1,
      auxiliary: {
        action: {
          value: action,
          type: "string",
        },
        requestId: {
          value: requestId,
          type: "string",
        },
        modelName: {
          value: llmClient.modelName,
          type: "string",
        },
      },
    });

    return this.actHandler
      .act({
        action,
        llmClient,
        chunksSeen: [],
        useVision,
        verifierUseVision: useVision !== false,
        requestId,
        variables,
        previousSelectors: [],
        skipActionCacheForThisStep: false,
        domSettleTimeoutMs,
      })
      .catch((e) => {
        this.stagehand.log({
          category: "act",
          message: "error acting",
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

        return {
          success: false,
          message: `Internal error: Error acting: ${e.message}`,
          action: action,
        };
      });
  }
}

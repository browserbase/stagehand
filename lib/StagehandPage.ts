import type {
  Page as PlaywrightPage,
  BrowserContext as PlaywrightContext,
  CDPSession,
} from "@playwright/test";
import { LLMClient } from "./llm/LLMClient";
import { ActOptions, ActResult, GotoOptions, Stagehand } from "./index";
import { StagehandActHandler } from "./handlers/actHandler";
import { StagehandContext } from "./StagehandContext";
import { Page, defaultExtractSchema } from "../types/page";
import {
  ExtractOptions,
  ExtractResult,
  ObserveOptions,
  ObserveResult,
} from "../types/stagehand";
import { z } from "zod";
import { StagehandExtractHandler } from "./handlers/extractHandler";
import { StagehandObserveHandler } from "./handlers/observeHandler";

export class StagehandPage {
  private stagehand: Stagehand;
  private intPage: Page;
  private intContext: StagehandContext;
  private actHandler: StagehandActHandler;
  private extractHandler: StagehandExtractHandler;
  private observeHandler: StagehandObserveHandler;
  private llmClient: LLMClient;
  private cdpClient: CDPSession | null = null;

  constructor(
    page: PlaywrightPage,
    stagehand: Stagehand,
    context: StagehandContext,
    llmClient: LLMClient,
    userProvidedInstructions?: string,
  ) {
    this.intPage = Object.assign(page, {
      act: () => {
        throw new Error(
          "You seem to be calling `act` on a page in an uninitialized `Stagehand` object. Ensure you are running `await stagehand.init()` on the Stagehand object before referencing the `page` object.",
        );
      },
      extract: () => {
        throw new Error(
          "You seem to be calling `extract` on a page in an uninitialized `Stagehand` object. Ensure you are running `await stagehand.init()` on the Stagehand object before referencing the `page` object.",
        );
      },
      observe: () => {
        throw new Error(
          "You seem to be calling `observe` on a page in an uninitialized `Stagehand` object. Ensure you are running `await stagehand.init()` on the Stagehand object before referencing the `page` object.",
        );
      },
      on: () => {
        throw new Error(
          "You seem to be referencing a page in an uninitialized `Stagehand` object. Ensure you are running `await stagehand.init()` on the Stagehand object before referencing the `page` object.",
        );
      },
    });
    this.stagehand = stagehand;
    this.intContext = context;
    this.llmClient = llmClient;
    if (this.llmClient) {
      this.actHandler = new StagehandActHandler({
        verbose: this.stagehand.verbose,
        llmProvider: this.stagehand.llmProvider,
        enableCaching: this.stagehand.enableCaching,
        logger: this.stagehand.logger,
        stagehandPage: this,
        stagehandContext: this.intContext,
        llmClient: llmClient,
        userProvidedInstructions,
      });
      this.extractHandler = new StagehandExtractHandler({
        stagehand: this.stagehand,
        logger: this.stagehand.logger,
        stagehandPage: this,
        userProvidedInstructions,
      });
      this.observeHandler = new StagehandObserveHandler({
        stagehand: this.stagehand,
        logger: this.stagehand.logger,
        stagehandPage: this,
        userProvidedInstructions,
      });
    }
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

        if (this.llmClient) {
          if (prop === "act") {
            return async (options: ActOptions) => {
              return this.act(options);
            };
          }
          if (prop === "extract") {
            return async (options: ExtractOptions<z.AnyZodObject>) => {
              return this.extract(options);
            };
          }
          if (prop === "observe") {
            return async (options: ObserveOptions) => {
              return this.observe(options);
            };
          }
        } else {
          if (prop === "act" || prop === "extract" || prop === "observe") {
            return () => {
              throw new Error(
                "No LLM API key or LLM Client configured. An LLM API key or a custom LLM Client is required to use act, extract, or observe.",
              );
            };
          }
        }

        if (prop === "on") {
          return (event: string, listener: (param: unknown) => void) => {
            if (event === "popup") {
              return this.context.on("page", async (page) => {
                const newContext = await StagehandContext.init(
                  page.context(),
                  stagehand,
                );
                const newStagehandPage = new StagehandPage(
                  page,
                  stagehand,
                  newContext,
                  this.llmClient,
                );

                await newStagehandPage.init();

                listener(newStagehandPage.page);
              });
            }

            return this.context.on(
              event as keyof PlaywrightPage["on"],
              listener,
            );
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

  async act(actionOrOptions: string | ActOptions): Promise<ActResult> {
    if (!this.actHandler) {
      throw new Error("Act handler not initialized");
    }

    const options: ActOptions =
      typeof actionOrOptions === "string"
        ? { action: actionOrOptions }
        : actionOrOptions;

    const {
      action,
      modelName,
      modelClientOptions,
      useVision, // still destructure this but will not pass it on
      variables = {},
      domSettleTimeoutMs,
    } = options;

    if (typeof useVision !== "undefined") {
      this.stagehand.log({
        category: "deprecation",
        message:
          "Warning: vision is not supported in this version of Stagehand",
        level: 1,
      });
    }

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

    // `useVision` is no longer passed to the handler
    return this.actHandler
      .act({
        action,
        llmClient,
        chunksSeen: [],
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

  async extract<T extends z.AnyZodObject = typeof defaultExtractSchema>(
    instructionOrOptions: string | ExtractOptions<T>,
  ): Promise<ExtractResult<T>> {
    if (!this.extractHandler) {
      throw new Error("Extract handler not initialized");
    }

    const options: ExtractOptions<T> =
      typeof instructionOrOptions === "string"
        ? {
            instruction: instructionOrOptions,
            schema: defaultExtractSchema as T,
          }
        : instructionOrOptions;

    const {
      instruction,
      schema,
      modelName,
      modelClientOptions,
      domSettleTimeoutMs,
      useTextExtract,
    } = options;

    const requestId = Math.random().toString(36).substring(2);
    const llmClient = modelName
      ? this.stagehand.llmProvider.getClient(modelName, modelClientOptions)
      : this.llmClient;

    this.stagehand.log({
      category: "extract",
      message: "running extract",
      level: 1,
      auxiliary: {
        instruction: {
          value: instruction,
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

    return this.extractHandler
      .extract({
        instruction,
        schema,
        llmClient,
        requestId,
        domSettleTimeoutMs,
        useTextExtract,
      })
      .catch((e) => {
        this.stagehand.log({
          category: "extract",
          message: "error extracting",
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

        if (this.stagehand.enableCaching) {
          this.stagehand.llmProvider.cleanRequestCache(requestId);
        }

        throw e;
      });
  }

  async observe(
    instructionOrOptions?: string | ObserveOptions,
  ): Promise<ObserveResult[]> {
    if (!this.observeHandler) {
      throw new Error("Observe handler not initialized");
    }

    const options: ObserveOptions =
      typeof instructionOrOptions === "string"
        ? { instruction: instructionOrOptions }
        : instructionOrOptions || {};

    const {
      instruction = "Find actions that can be performed on this page.",
      modelName,
      modelClientOptions,
      useVision, // still destructure but will not pass it on
      domSettleTimeoutMs,
      useAccessibilityTree = false,
    } = options;

    if (typeof useVision !== "undefined") {
      this.stagehand.log({
        category: "deprecation",
        message:
          "Warning: vision is not supported in this version of Stagehand",
        level: 1,
      });
    }

    const requestId = Math.random().toString(36).substring(2);
    const llmClient = modelName
      ? this.stagehand.llmProvider.getClient(modelName, modelClientOptions)
      : this.llmClient;

    this.stagehand.log({
      category: "observe",
      message: "running observe",
      level: 1,
      auxiliary: {
        instruction: {
          value: instruction,
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
        useAccessibilityTree: {
          value: useAccessibilityTree ? "true" : "false",
          type: "boolean",
        },
      },
    });

    return this.observeHandler
      .observe({
        instruction,
        llmClient,
        requestId,
        domSettleTimeoutMs,
        useAccessibilityTree,
      })
      .catch((e) => {
        this.stagehand.log({
          category: "observe",
          message: "error observing",
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
            requestId: {
              value: requestId,
              type: "string",
            },
            instruction: {
              value: instruction,
              type: "string",
            },
          },
        });

        if (this.stagehand.enableCaching) {
          this.stagehand.llmProvider.cleanRequestCache(requestId);
        }

        throw e;
      });
  }

  async getCDPClient(): Promise<CDPSession> {
    if (!this.cdpClient) {
      this.cdpClient = await this.context.newCDPSession(this.page);
    }
    return this.cdpClient;
  }

  async sendCDP<T>(
    command: string,
    args?: Record<string, unknown>,
  ): Promise<T> {
    const client = await this.getCDPClient();
    // Type assertion needed because CDP command strings are not fully typed
    return client.send(
      command as Parameters<CDPSession["send"]>[0],
      args || {},
    ) as Promise<T>;
  }

  async enableCDP(domain: string): Promise<void> {
    await this.sendCDP(`${domain}.enable`, {});
  }

  async disableCDP(domain: string): Promise<void> {
    await this.sendCDP(`${domain}.disable`, {});
  }
}

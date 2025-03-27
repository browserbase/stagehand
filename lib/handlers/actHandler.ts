import { Locator } from "@playwright/test";
import { LogLine } from "../../types/log";
import {
  PlaywrightCommandException,
  PlaywrightCommandMethodNotSupportedException,
} from "../../types/playwright";
import { ActionCache } from "../cache/ActionCache";
import { act, fillInVariables, verifyActCompletion } from "../inference";
import { LLMClient } from "../llm/LLMClient";
import { LLMProvider } from "../llm/LLMProvider";
import { StagehandContext } from "../StagehandContext";
import { StagehandPage } from "../StagehandPage";
import { generateId } from "../utils";
import {
  ActResult,
  ObserveResult,
  ActOptions,
  ObserveOptions,
  StagehandFunctionName,
} from "@/types/stagehand";
import { MethodHandlerContext, SupportedPlaywrightAction } from "@/types/act";
import { buildActObservePrompt } from "../prompt";
import {
  methodHandlerMap,
  fallbackLocatorMethod,
} from "./handlerUtils/actHandlerUtils";
import { Stagehand } from "@/lib";
import { StagehandObserveHandler } from "@/lib/handlers/observeHandler";
import {
  StagehandElementNotFoundError,
  StagehandInvalidArgumentError,
} from "@/types/stagehandErrors";
/**
 * NOTE: Vision support has been removed from this version of Stagehand.
 * If useVision or verifierUseVision is set to true, a warning is logged and
 * the flow continues as if vision = false.
 */
export class StagehandActHandler {
  private readonly stagehand: Stagehand;
  private readonly stagehandPage: StagehandPage;
  private readonly verbose: 0 | 1 | 2;
  private readonly llmProvider: LLMProvider;
  private readonly enableCaching: boolean;
  private readonly logger: (logLine: LogLine) => void;
  private readonly actionCache: ActionCache | undefined;
  private readonly actions: {
    [key: string]: { result: string; action: string };
  };
  private readonly userProvidedInstructions?: string;
  private readonly selfHeal: boolean;
  private readonly waitForCaptchaSolves: boolean;

  constructor({
    stagehand,
    verbose,
    llmProvider,
    enableCaching,
    logger,
    stagehandPage,
    userProvidedInstructions,
    selfHeal,
    waitForCaptchaSolves,
  }: {
    stagehand: Stagehand;
    verbose: 0 | 1 | 2;
    llmProvider: LLMProvider;
    enableCaching: boolean;
    logger: (logLine: LogLine) => void;
    llmClient: LLMClient;
    stagehandPage: StagehandPage;
    stagehandContext: StagehandContext;
    userProvidedInstructions?: string;
    selfHeal: boolean;
    waitForCaptchaSolves: boolean;
  }) {
    this.stagehand = stagehand;
    this.verbose = verbose;
    this.llmProvider = llmProvider;
    this.enableCaching = enableCaching;
    this.logger = logger;
    this.actionCache = enableCaching ? new ActionCache(this.logger) : undefined;
    this.actions = {};
    this.stagehandPage = stagehandPage;
    this.userProvidedInstructions = userProvidedInstructions;
    this.selfHeal = selfHeal;
    this.waitForCaptchaSolves = waitForCaptchaSolves;
  }

  /**
   * Perform an immediate Playwright action based on an ObserveResult object
   * that was returned from `page.observe(...)`.
   */
  public async actFromObserveResult(
    observe: ObserveResult,
    domSettleTimeoutMs?: number,
  ): Promise<ActResult> {
    this.logger({
      category: "action",
      message: "Performing act from an ObserveResult",
      level: 1,
      auxiliary: {
        observeResult: {
          value: JSON.stringify(observe),
          type: "object",
        },
      },
    });

    const method = observe.method;
    if (method === "not-supported") {
      this.logger({
        category: "action",
        message: "Cannot execute ObserveResult with unsupported method",
        level: 1,
        auxiliary: {
          error: {
            value:
              "NotSupportedError: The method requested in this ObserveResult is not supported by Stagehand.",
            type: "string",
          },
          trace: {
            value: `Cannot execute act from ObserveResult with unsupported method: ${method}`,
            type: "string",
          },
        },
      });
      return {
        success: false,
        message: `Unable to perform action: The method '${method}' is not supported in ObserveResult. Please use a supported Playwright locator method.`,
        action: observe.description || `ObserveResult action (${method})`,
      };
    }
    const args = observe.arguments ?? [];
    // remove the xpath prefix on the selector
    const selector = observe.selector.replace("xpath=", "");

    try {
      await this._performPlaywrightMethod(
        method,
        args,
        selector,
        domSettleTimeoutMs,
      );

      return {
        success: true,
        message: `Action [${method}] performed successfully on selector: ${selector}`,
        action: observe.description || `ObserveResult action (${method})`,
      };
    } catch (err) {
      if (
        !this.selfHeal ||
        err instanceof PlaywrightCommandMethodNotSupportedException
      ) {
        this.logger({
          category: "action",
          message: "Error performing act from an ObserveResult",
          level: 1,
          auxiliary: {
            error: { value: err.message, type: "string" },
            trace: { value: err.stack, type: "string" },
          },
        });
        return {
          success: false,
          message: `Failed to perform act: ${err.message}`,
          action: observe.description || `ObserveResult action (${method})`,
        };
      }
      // We will try to use regular act on a failed ObserveResult-act if selfHeal is true
      this.logger({
        category: "action",
        message:
          "Error performing act from an ObserveResult. Trying again with regular act method",
        level: 1,
        auxiliary: {
          error: { value: err.message, type: "string" },
          trace: { value: err.stack, type: "string" },
          observeResult: { value: JSON.stringify(observe), type: "object" },
        },
      });
      try {
        // Remove redundancy from method-description
        const actCommand = observe.description
          .toLowerCase()
          .startsWith(method.toLowerCase())
          ? observe.description
          : method
            ? `${method} ${observe.description}`
            : observe.description;
        // Call act with the ObserveResult description
        return await this.stagehandPage.act({
          action: actCommand,
          slowDomBasedAct: true,
        });
      } catch (err) {
        this.logger({
          category: "action",
          message: "Error performing act from an ObserveResult on fallback",
          level: 1,
          auxiliary: {
            error: { value: err.message, type: "string" },
            trace: { value: err.stack, type: "string" },
          },
        });
        return {
          success: false,
          message: `Failed to perform act: ${err.message}`,
          action: observe.description || `ObserveResult action (${method})`,
        };
      }
    }
  }

  /**
   * Perform an act based on an instruction.
   * This method will observe the page and then perform the act on the first element returned.
   */
  public async observeAct(
    actionOrOptions: ActOptions,
    observeHandler: StagehandObserveHandler,
    llmClient: LLMClient,
    requestId: string,
  ): Promise<ActResult> {
    // Extract the action string
    let action: string;
    const observeOptions: Partial<ObserveOptions> = {};

    if (typeof actionOrOptions === "object" && actionOrOptions !== null) {
      if (!("action" in actionOrOptions)) {
        throw new StagehandInvalidArgumentError(
          "Invalid argument. Action options must have an `action` field.",
        );
      }

      if (
        typeof actionOrOptions.action !== "string" ||
        actionOrOptions.action.length === 0
      ) {
        throw new StagehandInvalidArgumentError(
          "Invalid argument. No action provided.",
        );
      }

      action = actionOrOptions.action;

      // Extract options that should be passed to observe
      if (actionOrOptions.modelName)
        observeOptions.modelName = actionOrOptions.modelName;
      if (actionOrOptions.modelClientOptions)
        observeOptions.modelClientOptions = actionOrOptions.modelClientOptions;
    } else {
      throw new StagehandInvalidArgumentError(
        "Invalid argument. Valid arguments are: a string, an ActOptions object with an `action` field not empty, or an ObserveResult with a `selector` and `method` field.",
      );
    }

    // Craft the instruction for observe
    const instruction = buildActObservePrompt(
      action,
      Object.values(SupportedPlaywrightAction),
      actionOrOptions.variables,
    );

    // Call observe with the instruction and extracted options
    const observeResults = await observeHandler.observe({
      instruction,
      llmClient: llmClient,
      requestId,
      onlyVisible: false,
      drawOverlay: false,
      returnAction: true,
    });

    if (observeResults.length === 0) {
      return {
        success: false,
        message: `Failed to perform act: No observe results found for action`,
        action,
      };
    }

    // Perform the action on the first observed element
    const element: ObserveResult = observeResults[0];
    // Replace the arguments with the variables if any
    if (actionOrOptions.variables) {
      Object.keys(actionOrOptions.variables).forEach((key) => {
        element.arguments = element.arguments.map((arg) =>
          arg.replace(key, actionOrOptions.variables[key]),
        );
      });
    }
    return this.actFromObserveResult(
      element,
      actionOrOptions.domSettleTimeoutMs,
    );
  }

  private async _recordAction(action: string, result: string): Promise<string> {
    const id = generateId(action);

    this.actions[id] = { result, action };

    return id;
  }

  private async _verifyActionCompletion({
    completed,
    requestId,
    action,
    steps,
    llmClient,
    domSettleTimeoutMs,
  }: {
    completed: boolean;
    requestId: string;
    action: string;
    steps: string;
    llmClient: LLMClient;
    domSettleTimeoutMs?: number;
  }): Promise<boolean> {
    if (!completed) {
      return false;
    }

    await this.stagehandPage._waitForSettledDom(domSettleTimeoutMs);

    // o1 is overkill for this task + this task uses a lot of tokens. So we switch it 4o
    let verifyLLmClient = llmClient;
    if (
      llmClient.modelName.startsWith("o1") ||
      llmClient.modelName.startsWith("o3")
    ) {
      verifyLLmClient = this.llmProvider.getClient(
        "gpt-4o",
        llmClient.clientOptions,
      );
    }

    const { outputString: domElements } =
      await this.stagehandPage.page.evaluate(() => {
        return window.processAllOfDom();
      });

    let actionCompleted = false;
    if (completed) {
      // Run action completion verifier
      this.logger({
        category: "action",
        message: "action marked as completed, verifying if this is true...",
        level: 1,
        auxiliary: {
          action: {
            value: action,
            type: "string",
          },
        },
      });

      // Always use text-based DOM verification (no vision).
      const verifyResult = await verifyActCompletion({
        goal: action,
        steps,
        llmProvider: this.llmProvider,
        llmClient: verifyLLmClient,
        domElements,
        logger: this.logger,
        requestId,
        logInferenceToFile: this.stagehand.logInferenceToFile,
      });
      actionCompleted = verifyResult.completed;

      this.logger({
        category: "action",
        message: "action completion verification result",
        level: 1,
        auxiliary: {
          action: {
            value: action,
            type: "string",
          },
          result: {
            value: actionCompleted.toString(),
            type: "boolean",
          },
        },
      });
      this.stagehand.updateMetrics(
        StagehandFunctionName.ACT,
        verifyResult.prompt_tokens,
        verifyResult.completion_tokens,
        verifyResult.inference_time_ms,
      );
    }

    return actionCompleted;
  }

  private async _performPlaywrightMethod(
    method: string,
    args: unknown[],
    xpath: string,
    domSettleTimeoutMs?: number,
  ) {
    const locator = this.stagehandPage.page.locator(`xpath=${xpath}`).first();
    const initialUrl = this.stagehandPage.page.url();

    this.logger({
      category: "action",
      message: "performing playwright method",
      level: 2,
      auxiliary: {
        xpath: { value: xpath, type: "string" },
        method: { value: method, type: "string" },
      },
    });

    const context: MethodHandlerContext = {
      method,
      locator,
      xpath,
      args,
      logger: this.logger,
      stagehandPage: this.stagehandPage,
      initialUrl,
      domSettleTimeoutMs,
    };

    try {
      // 1) Look up a function in the map
      const methodFn = methodHandlerMap[method];

      // 2) If found, call it
      if (methodFn) {
        await methodFn(context);

        // 3) Otherwise, see if it's a valid locator method
      } else if (typeof locator[method as keyof Locator] === "function") {
        await fallbackLocatorMethod(context);

        // 4) If still unknown, we can’t handle it
      } else {
        this.logger({
          category: "action",
          message: "chosen method is invalid",
          level: 1,
          auxiliary: {
            method: { value: method, type: "string" },
          },
        });
        throw new PlaywrightCommandMethodNotSupportedException(
          `Method ${method} not supported`,
        );
      }

      // Always wait for DOM to settle
      await this.stagehandPage._waitForSettledDom(domSettleTimeoutMs);
    } catch (e) {
      this.logger({
        category: "action",
        message: "error performing method",
        level: 1,
        auxiliary: {
          error: { value: e.message, type: "string" },
          trace: { value: e.stack, type: "string" },
          method: { value: method, type: "string" },
          xpath: { value: xpath, type: "string" },
          args: { value: JSON.stringify(args), type: "object" },
        },
      });
      throw new PlaywrightCommandException(e.message);
    }
  }

  private async _getComponentString(locator: Locator) {
    return await locator.evaluate((el) => {
      // Create a clone of the element to avoid modifying the original
      const clone = el.cloneNode(true) as HTMLElement;

      // Keep only specific stable attributes that help identify elements
      const attributesToKeep = [
        "type",
        "name",
        "placeholder",
        "aria-label",
        "role",
        "href",
        "title",
        "alt",
      ];

      // Remove all attributes except those we want to keep
      Array.from(clone.attributes).forEach((attr) => {
        if (!attributesToKeep.includes(attr.name)) {
          clone.removeAttribute(attr.name);
        }
      });

      const outerHtml = clone.outerHTML;
      return outerHtml.trim().replace(/\s+/g, " ");
    });
  }

  public async act({
    action,
    steps = "",
    chunksSeen,
    llmClient,
    retries = 0,
    requestId,
    variables,
    previousSelectors,
    skipActionCacheForThisStep = false,
    domSettleTimeoutMs,
    timeoutMs,
    startTime = Date.now(),
  }: {
    action: string;
    steps?: string;
    chunksSeen: number[];
    llmClient: LLMClient;
    retries?: number;
    requestId?: string;
    variables: Record<string, string>;
    previousSelectors: string[];
    skipActionCacheForThisStep: boolean;
    domSettleTimeoutMs?: number;
    timeoutMs?: number;
    startTime?: number;
  }): Promise<{ success: boolean; message: string; action: string }> {
    try {
      await this.stagehandPage._waitForSettledDom(domSettleTimeoutMs);

      if (timeoutMs && startTime) {
        const elapsedTime = Date.now() - startTime;
        if (elapsedTime > timeoutMs) {
          return {
            success: false,
            message: `Action timed out after ${timeoutMs}ms`,
            action: action,
          };
        }
      }

      this.logger({
        category: "action",
        message: "running / continuing action",
        level: 2,
        auxiliary: {
          action: {
            value: action,
            type: "string",
          },
          pageUrl: {
            value: this.stagehandPage.page.url(),
            type: "string",
          },
        },
      });

      this.logger({
        category: "action",
        message: "processing DOM",
        level: 2,
      });

      const { outputString, selectorMap, chunk, chunks } =
        await this.stagehandPage.page.evaluate(
          ({ chunksSeen }: { chunksSeen: number[] }) => {
            return window.processDom(chunksSeen);
          },
          { chunksSeen },
        );

      this.logger({
        category: "action",
        message: "looking at chunk",
        level: 1,
        auxiliary: {
          chunk: {
            value: chunk.toString(),
            type: "integer",
          },
          chunks: {
            value: chunks.length.toString(),
            type: "integer",
          },
          chunksSeen: {
            value: chunksSeen.length.toString(),
            type: "integer",
          },
          chunksLeft: {
            value: (chunks.length - chunksSeen.length).toString(),
            type: "integer",
          },
        },
      });

      // Run the LLM-based inference with text only
      const response = await act({
        action,
        domElements: outputString,
        steps,
        llmClient,
        logger: this.logger,
        requestId,
        variables,
        userProvidedInstructions: this.userProvidedInstructions,
        onActMetrics: (promptTokens, completionTokens, inferenceTimeMs) => {
          this.stagehand.updateMetrics(
            StagehandFunctionName.ACT,
            promptTokens,
            completionTokens,
            inferenceTimeMs,
          );
        },
        logInferenceToFile: this.stagehand.logInferenceToFile,
      });

      this.logger({
        category: "action",
        message: "received response from LLM",
        level: 1,
        auxiliary: {
          response: {
            value: JSON.stringify(response),
            type: "object",
          },
        },
      });

      if (!response) {
        if (chunksSeen.length + 1 < chunks.length) {
          chunksSeen.push(chunk);

          this.logger({
            category: "action",
            message: "no action found in current chunk",
            level: 1,
            auxiliary: {
              chunksSeen: {
                value: chunksSeen.length.toString(),
                type: "integer",
              },
            },
          });

          return this.act({
            action,
            steps:
              steps +
              (!steps.endsWith("\n") ? "\n" : "") +
              "## Step: Scrolled to another section\n",
            chunksSeen,
            llmClient,
            requestId,
            variables,
            previousSelectors,
            skipActionCacheForThisStep,
            domSettleTimeoutMs,
            timeoutMs,
            startTime,
          });
        } else {
          if (this.enableCaching) {
            this.llmProvider.cleanRequestCache(requestId);
            this.actionCache?.deleteCacheForRequestId(requestId);
          }

          return {
            success: false,
            message: `Action was not able to be completed.`,
            action: action,
          };
        }
      }

      // Action found, proceed to execute
      const elementId = response["element"];
      const xpaths = selectorMap[elementId];
      const method = response["method"];
      const args = response["args"];

      // Get the element text from the outputString
      const elementLines = outputString.split("\n");
      const elementText =
        elementLines
          .find((line) => line.startsWith(`${elementId}:`))
          ?.split(":")[1] || "Element not found";

      this.logger({
        category: "action",
        message: "executing method",
        level: 1,
        auxiliary: {
          method: {
            value: method,
            type: "string",
          },
          elementId: {
            value: elementId.toString(),
            type: "integer",
          },
          xpaths: {
            value: JSON.stringify(xpaths),
            type: "object",
          },
          args: {
            value: JSON.stringify(args),
            type: "object",
          },
        },
      });

      try {
        const initialUrl = this.stagehandPage.page.url();

        // Modified: Attempt to locate the first valid XPath before proceeding
        let foundXpath: string | null = null;
        let locator: Locator | null = null;

        for (const xp of xpaths) {
          const candidate = this.stagehandPage.page
            .locator(`xpath=${xp}`)
            .first();
          try {
            // Try a short wait to see if it's attached to the DOM
            await candidate.waitFor({ state: "attached", timeout: 2000 });
            foundXpath = xp;
            locator = candidate;
            break;
          } catch (e) {
            this.logger({
              category: "action",
              message: "XPath not yet located; moving on",
              level: 1,
              auxiliary: {
                xpath: {
                  value: xp,
                  type: "string",
                },
                error: {
                  value: e.message,
                  type: "string",
                },
              },
            });
            // Continue to next XPath
          }
        }

        // If no XPath was valid, we cannot proceed
        if (!foundXpath || !locator) {
          throw new StagehandElementNotFoundError(xpaths);
        }

        const originalUrl = this.stagehandPage.page.url();
        const componentString = await this._getComponentString(locator);
        const responseArgs = [...args];

        if (variables) {
          responseArgs.forEach((arg, index) => {
            if (typeof arg === "string") {
              args[index] = fillInVariables(arg, variables);
            }
          });
        }

        await this._performPlaywrightMethod(
          method,
          args,
          foundXpath,
          domSettleTimeoutMs,
        );

        const newStepString =
          (!steps.endsWith("\n") ? "\n" : "") +
          `## Step: ${response.step}\n` +
          `  Element: ${elementText}\n` +
          `  Action: ${response.method}\n` +
          `  Reasoning: ${response.why}\n`;

        steps += newStepString;

        if (this.enableCaching) {
          this.actionCache
            .addActionStep({
              action,
              url: originalUrl,
              previousSelectors,
              playwrightCommand: {
                method,
                args: responseArgs.map((arg) => arg?.toString() || ""),
              },
              componentString,
              requestId,
              xpaths,
              newStepString,
              completed: response.completed,
            })
            .catch((e) => {
              this.logger({
                category: "action",
                message: "error adding action step to cache",
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
            });
        }

        if (this.stagehandPage.page.url() !== initialUrl) {
          steps += `  Result (Important): Page URL changed from ${initialUrl} to ${this.stagehandPage.page.url()}\n\n`;

          if (this.waitForCaptchaSolves) {
            try {
              await this.stagehandPage.waitForCaptchaSolve(1000);
            } catch {
              // ignore
            }
          }
        }

        const actionCompleted = await this._verifyActionCompletion({
          completed: response.completed,
          requestId,
          action,
          steps,
          llmClient,
          domSettleTimeoutMs,
        }).catch((error) => {
          this.logger({
            category: "action",
            message:
              "error verifying action completion. Assuming action completed.",
            level: 1,
            auxiliary: {
              error: {
                value: error.message,
                type: "string",
              },
              trace: {
                value: error.stack,
                type: "string",
              },
            },
          });

          return true;
        });

        if (!actionCompleted) {
          this.logger({
            category: "action",
            message: "continuing to next action step",
            level: 1,
          });

          return this.act({
            action,
            steps,
            llmClient,
            chunksSeen,
            requestId,
            variables,
            previousSelectors: [...previousSelectors, foundXpath],
            skipActionCacheForThisStep: false,
            domSettleTimeoutMs,
            timeoutMs,
            startTime,
          });
        } else {
          this.logger({
            category: "action",
            message: "action completed successfully",
            level: 1,
          });
          await this._recordAction(action, response.step);
          return {
            success: true,
            message: `Action completed successfully: ${steps}${response.step}`,
            action: action,
          };
        }
      } catch (error) {
        this.logger({
          category: "action",
          message: "error performing action - d",
          level: 1,
          auxiliary: {
            error: {
              value: error.message,
              type: "string",
            },
            trace: {
              value: error.stack,
              type: "string",
            },
            retries: {
              value: retries.toString(),
              type: "integer",
            },
          },
        });

        if (retries < 2) {
          return this.act({
            action,
            steps,
            llmClient,
            retries: retries + 1,
            chunksSeen,
            requestId,
            variables,
            previousSelectors,
            skipActionCacheForThisStep,
            domSettleTimeoutMs,
            timeoutMs,
            startTime,
          });
        }

        await this._recordAction(action, "");
        if (this.enableCaching) {
          this.llmProvider.cleanRequestCache(requestId);
          this.actionCache.deleteCacheForRequestId(requestId);
        }

        return {
          success: false,
          message: "error performing action - a",
          action: action,
        };
      }
    } catch (error) {
      this.logger({
        category: "action",
        message: "error performing action - b",
        level: 1,
        auxiliary: {
          error: {
            value: error.message,
            type: "string",
          },
          trace: {
            value: error.stack,
            type: "string",
          },
        },
      });

      if (this.enableCaching) {
        this.llmProvider.cleanRequestCache(requestId);
        this.actionCache.deleteCacheForRequestId(requestId);
      }

      return {
        success: false,
        message: `Error performing action - C: ${error.message}`,
        action: action,
      };
    }
  }
}

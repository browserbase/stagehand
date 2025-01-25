import { Locator, Page } from "@playwright/test";
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

/**
 * NOTE: Vision support has been removed from this version of Stagehand.
 * If useVision or verifierUseVision is set to true, a warning is logged and
 * the flow continues as if vision = false.
 */
export class StagehandActHandler {
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

  constructor({
    verbose,
    llmProvider,
    enableCaching,
    logger,
    stagehandPage,
    userProvidedInstructions,
  }: {
    verbose: 0 | 1 | 2;
    llmProvider: LLMProvider;
    enableCaching: boolean;
    logger: (logLine: LogLine) => void;
    llmClient: LLMClient;
    stagehandPage: StagehandPage;
    stagehandContext: StagehandContext;
    userProvidedInstructions?: string;
  }) {
    this.verbose = verbose;
    this.llmProvider = llmProvider;
    this.enableCaching = enableCaching;
    this.logger = logger;
    this.actionCache = enableCaching ? new ActionCache(this.logger) : undefined;
    this.actions = {};
    this.stagehandPage = stagehandPage;
    this.userProvidedInstructions = userProvidedInstructions;
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
      llmClient.modelName === "o1-mini" ||
      llmClient.modelName === "o1-preview" ||
      llmClient.modelName.startsWith("o1-")
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
      actionCompleted = await verifyActCompletion({
        goal: action,
        steps,
        llmProvider: this.llmProvider,
        llmClient: verifyLLmClient,
        domElements,
        logger: this.logger,
        requestId,
      });

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
        xpath: {
          value: xpath,
          type: "string",
        },
        method: {
          value: method,
          type: "string",
        },
      },
    });

    if (method === "scrollIntoView") {
      this.logger({
        category: "action",
        message: "scrolling element into view",
        level: 2,
        auxiliary: {
          xpath: {
            value: xpath,
            type: "string",
          },
        },
      });
      try {
        await locator
          .evaluate((element: HTMLElement) => {
            element.scrollIntoView({ behavior: "smooth", block: "center" });
          })
          .catch((e: Error) => {
            this.logger({
              category: "action",
              message: "error scrolling element into view",
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
                xpath: {
                  value: xpath,
                  type: "string",
                },
              },
            });
          });
      } catch (e) {
        this.logger({
          category: "action",
          message: "error scrolling element into view",
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
            xpath: {
              value: xpath,
              type: "string",
            },
          },
        });

        throw new PlaywrightCommandException(e.message);
      }
    } else if (method === "fill" || method === "type") {
      try {
        await locator.fill("");
        await locator.click();
        const text = args[0]?.toString();
        for (const char of text) {
          await this.stagehandPage.page.keyboard.type(char, {
            delay: Math.random() * 50 + 25,
          });
        }
      } catch (e) {
        this.logger({
          category: "action",
          message: "error filling element",
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
            xpath: {
              value: xpath,
              type: "string",
            },
          },
        });

        throw new PlaywrightCommandException(e.message);
      }
    } else if (method === "press") {
      try {
        const key = args[0]?.toString();
        await this.stagehandPage.page.keyboard.press(key);
      } catch (e) {
        this.logger({
          category: "action",
          message: "error pressing key",
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
            key: {
              value: args[0]?.toString() ?? "unknown",
              type: "string",
            },
          },
        });

        throw new PlaywrightCommandException(e.message);
      }
    } else if (typeof locator[method as keyof typeof locator] === "function") {
      // Log current URL before action
      this.logger({
        category: "action",
        message: "page URL before action",
        level: 2,
        auxiliary: {
          url: {
            value: this.stagehandPage.page.url(),
            type: "string",
          },
        },
      });

      // Perform the action
      try {
        await (
          locator[method as keyof Locator] as unknown as (
            ...args: string[]
          ) => Promise<void>
        )(...args.map((arg) => arg?.toString() || ""));
      } catch (e) {
        this.logger({
          category: "action",
          message: "error performing method",
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
            xpath: {
              value: xpath,
              type: "string",
            },
            method: {
              value: method,
              type: "string",
            },
            args: {
              value: JSON.stringify(args),
              type: "object",
            },
          },
        });

        throw new PlaywrightCommandException(e.message);
      }

      // Handle navigation if a new page is opened
      if (method === "click") {
        this.logger({
          category: "action",
          message: "clicking element, checking for page navigation",
          level: 1,
          auxiliary: {
            xpath: {
              value: xpath,
              type: "string",
            },
          },
        });

        // NAVIDNOTE: Should this happen before we wait for locator[method]?
        const newOpenedTab = await Promise.race([
          new Promise<Page | null>((resolve) => {
            // TODO: This is a hack to get the new page
            // We should find a better way to do this
            this.stagehandPage.context.once("page", (page) => resolve(page));
            setTimeout(() => resolve(null), 1_500);
          }),
        ]);

        this.logger({
          category: "action",
          message: "clicked element",
          level: 1,
          auxiliary: {
            newOpenedTab: {
              value: newOpenedTab ? "opened a new tab" : "no new tabs opened",
              type: "string",
            },
          },
        });

        if (newOpenedTab) {
          this.logger({
            category: "action",
            message: "new page detected (new tab) with URL",
            level: 1,
            auxiliary: {
              url: {
                value: newOpenedTab.url(),
                type: "string",
              },
            },
          });
          await newOpenedTab.close();
          await this.stagehandPage.page.goto(newOpenedTab.url());
          await this.stagehandPage.page.waitForLoadState("domcontentloaded");
          await this.stagehandPage._waitForSettledDom(domSettleTimeoutMs);
        }

        await Promise.race([
          this.stagehandPage.page.waitForLoadState("networkidle"),
          new Promise((resolve) => setTimeout(resolve, 5_000)),
        ]).catch((e) => {
          this.logger({
            category: "action",
            message: "network idle timeout hit",
            level: 1,
            auxiliary: {
              trace: {
                value: e.stack,
                type: "string",
              },
              message: {
                value: e.message,
                type: "string",
              },
            },
          });
        });

        this.logger({
          category: "action",
          message: "finished waiting for (possible) page navigation",
          level: 1,
        });

        if (this.stagehandPage.page.url() !== initialUrl) {
          this.logger({
            category: "action",
            message: "new page detected with URL",
            level: 1,
            auxiliary: {
              url: {
                value: this.stagehandPage.page.url(),
                type: "string",
              },
            },
          });
        }
      }
    } else {
      this.logger({
        category: "action",
        message: "chosen method is invalid",
        level: 1,
        auxiliary: {
          method: {
            value: method,
            type: "string",
          },
        },
      });

      throw new PlaywrightCommandMethodNotSupportedException(
        `Method ${method} not supported`,
      );
    }

    await this.stagehandPage._waitForSettledDom(domSettleTimeoutMs);
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

      //   const variables = {
      //     // Replace with your actual variables and their values
      //     // Example:
      //     username: "JohnDoe",
      //     email: "john@example.com",
      //   };

      //   // Function to replace variable values with variable names
      //   const replaceVariables = (element: Element) => {
      //     if (element instanceof HTMLElement) {
      //       for (const [key, value] of Object.entries(variables)) {
      //         if (value) {
      //           element.innerText = element.innerText.replace(
      //             new RegExp(value, "g"),
      //             key,
      //           );
      //         }
      //       }
      //     }

      //     if (
      //       element instanceof HTMLInputElement ||
      //       element instanceof HTMLTextAreaElement
      //     ) {
      //       for (const [key, value] of Object.entries(variables)) {
      //         if (value) {
      //           element.value = element.value.replace(
      //             new RegExp(value, "g"),
      //             key,
      //           );
      //         }
      //       }
      //     }
      //   };

      //   // Replace variables in the cloned element
      //   replaceVariables(clone);

      //   // Replace variables in all child elements
      //   clone.querySelectorAll("*").forEach(replaceVariables);
      return outerHtml.trim().replace(/\s+/g, " ");
    });
  }

  private async getElement(
    xpath: string,
    timeout: number = 5_000,
  ): Promise<Locator | null> {
    try {
      const element = this.stagehandPage.page.locator(`xpath=${xpath}`).first();
      await element.waitFor({ state: "attached", timeout });
      return element;
    } catch {
      this.logger({
        category: "action",
        message: "element not found within timeout",
        level: 1,
        auxiliary: {
          xpath: {
            value: xpath,
            type: "string",
          },
          timeout_ms: {
            value: timeout.toString(),
            type: "integer",
          },
        },
      });
      return null;
    }
  }

  private async _checkIfCachedStepIsValid_oneXpath(cachedStep: {
    xpath: string;
    savedComponentString: string;
  }) {
    this.logger({
      category: "action",
      message: "checking if cached step is valid",
      level: 1,
      auxiliary: {
        xpath: {
          value: cachedStep.xpath,
          type: "string",
        },
        savedComponentString: {
          value: cachedStep.savedComponentString,
          type: "string",
        },
      },
    });
    try {
      const locator = await this.getElement(cachedStep.xpath);
      if (!locator) {
        this.logger({
          category: "action",
          message: "locator not found for xpath",
          level: 1,
          auxiliary: {
            xpath: {
              value: cachedStep.xpath,
              type: "string",
            },
          },
        });
        return false;
      }

      this.logger({
        category: "action",
        message: "locator element",
        level: 1,
        auxiliary: {
          componentString: {
            value: await this._getComponentString(locator),
            type: "string",
          },
        },
      });

      const currentComponent = await this._getComponentString(locator);

      this.logger({
        category: "action",
        message: "current text",
        level: 1,
        auxiliary: {
          componentString: {
            value: currentComponent,
            type: "string",
          },
        },
      });

      if (!currentComponent || !cachedStep.savedComponentString) {
        this.logger({
          category: "action",
          message: "current text or cached text is undefined",
          level: 1,
        });
        return false;
      }

      // Normalize whitespace and trim both strings before comparing
      const normalizedCurrentText = currentComponent
        .trim()
        .replace(/\s+/g, " ");
      const normalizedCachedText = cachedStep.savedComponentString
        .trim()
        .replace(/\s+/g, " ");

      if (normalizedCurrentText !== normalizedCachedText) {
        this.logger({
          category: "action",
          message: "current text and cached text do not match",
          level: 1,
          auxiliary: {
            currentText: {
              value: normalizedCurrentText,
              type: "string",
            },
            cachedText: {
              value: normalizedCachedText,
              type: "string",
            },
          },
        });
        return false;
      }

      return true;
    } catch (e) {
      this.logger({
        category: "action",
        message: "error checking if cached step is valid",
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
      return false; // Added explicit return false for error cases
    }
  }

  private async _getValidCachedStepXpath(cachedStep: {
    xpaths: string[];
    savedComponentString: string;
  }) {
    const reversedXpaths = [...cachedStep.xpaths].reverse(); // We reverse the xpaths to try the most cachable ones first
    for (const xpath of reversedXpaths) {
      const isValid = await this._checkIfCachedStepIsValid_oneXpath({
        xpath,
        savedComponentString: cachedStep.savedComponentString,
      });

      if (isValid) {
        return xpath;
      }
    }
    return null;
  }

  private async _runCachedActionIfAvailable({
    action,
    previousSelectors,
    requestId,
    steps,
    chunksSeen,
    llmClient,
    retries,
    variables,
    domSettleTimeoutMs,
  }: {
    action: string;
    previousSelectors: string[];
    requestId: string;
    steps: string;
    chunksSeen: number[];
    llmClient: LLMClient;
    retries: number;
    variables: Record<string, string>;
    domSettleTimeoutMs?: number;
  }) {
    if (!this.enableCaching) {
      return null;
    }

    const cacheObj = {
      url: this.stagehandPage.page.url(),
      action,
      previousSelectors,
      requestId,
    };

    this.logger({
      category: "action",
      message: "checking action cache",
      level: 1,
      auxiliary: {
        cacheObj: {
          value: JSON.stringify(cacheObj),
          type: "object",
        },
      },
    });

    const cachedStep = await this.actionCache.getActionStep(cacheObj);

    if (!cachedStep) {
      this.logger({
        category: "action",
        message: "action cache miss",
        level: 1,
        auxiliary: {
          cacheObj: {
            value: JSON.stringify(cacheObj),
            type: "object",
          },
        },
      });
      return null;
    }

    this.logger({
      category: "action",
      message: "action cache semi-hit",
      level: 1,
      auxiliary: {
        playwrightCommand: {
          value: JSON.stringify(cachedStep.playwrightCommand),
          type: "object",
        },
      },
    });

    try {
      const validXpath = await this._getValidCachedStepXpath({
        xpaths: cachedStep.xpaths,
        savedComponentString: cachedStep.componentString,
      });

      this.logger({
        category: "action",
        message: "cached action step is valid",
        level: 1,
        auxiliary: {
          validXpath: {
            value: validXpath,
            type: "string",
          },
        },
      });

      if (!validXpath) {
        this.logger({
          category: "action",
          message: "cached action step is invalid, removing...",
          level: 1,
          auxiliary: {
            cacheObj: {
              value: JSON.stringify(cacheObj),
              type: "object",
            },
          },
        });

        await this.actionCache?.removeActionStep(cacheObj);
        return null;
      }

      this.logger({
        category: "action",
        message: "action cache hit",
        level: 1,
        auxiliary: {
          playwrightCommand: {
            value: JSON.stringify(cachedStep.playwrightCommand),
            type: "object",
          },
        },
      });

      cachedStep.playwrightCommand.args = cachedStep.playwrightCommand.args.map(
        (arg) => {
          return fillInVariables(arg, variables);
        },
      );

      await this._performPlaywrightMethod(
        cachedStep.playwrightCommand.method,
        cachedStep.playwrightCommand.args,
        validXpath,
        domSettleTimeoutMs,
      );

      steps = steps + cachedStep.newStepString;
      await this.stagehandPage.page.evaluate(
        ({ chunksSeen }: { chunksSeen: number[] }) => {
          return window.processDom(chunksSeen);
        },
        { chunksSeen },
      );

      if (cachedStep.completed) {
        // Verify the action was completed successfully
        const actionCompleted = await this._verifyActionCompletion({
          completed: true,
          llmClient,
          steps,
          requestId,
          action,
          domSettleTimeoutMs,
        });

        this.logger({
          category: "action",
          message: "action completion verification result from cache",
          level: 1,
          auxiliary: {
            actionCompleted: {
              value: actionCompleted.toString(),
              type: "boolean",
            },
          },
        });

        if (actionCompleted) {
          return {
            success: true,
            message: "action completed successfully using cached step",
            action,
          };
        }
      }

      return this.act({
        action,
        steps,
        chunksSeen,
        llmClient,
        retries,
        requestId,
        variables,
        previousSelectors: [...previousSelectors, cachedStep.xpaths[0]],
        skipActionCacheForThisStep: false,
        domSettleTimeoutMs,
      });
    } catch (exception) {
      this.logger({
        category: "action",
        message: "error performing cached action step",
        level: 1,
        auxiliary: {
          error: {
            value: exception.message,
            type: "string",
          },
          trace: {
            value: exception.stack,
            type: "string",
          },
        },
      });

      await this.actionCache?.removeActionStep(cacheObj);
      return null;
    }
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
  }): Promise<{ success: boolean; message: string; action: string }> {
    try {
      await this.stagehandPage._waitForSettledDom(domSettleTimeoutMs);
      await this.stagehandPage.startDomDebug();

      if (this.enableCaching && !skipActionCacheForThisStep) {
        const response = await this._runCachedActionIfAvailable({
          action,
          previousSelectors,
          requestId,
          steps,
          chunksSeen,
          llmClient,
          retries,
          variables,
          domSettleTimeoutMs,
        });

        if (response !== null) {
          return response;
        } else {
          return this.act({
            action,
            steps,
            chunksSeen,
            llmClient,
            retries,
            requestId,
            variables,
            previousSelectors,
            skipActionCacheForThisStep: true,
            domSettleTimeoutMs,
          });
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

      await this.stagehandPage.cleanupDomDebug();

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
          throw new Error("None of the provided XPaths could be located.");
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

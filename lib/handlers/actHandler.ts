import { Stagehand } from "../index";
import { AvailableModel, LLMProvider } from "../llm/LLMProvider";
import { ScreenshotService } from "../vision";
import { verifyActCompletion, act, fillInVariables } from "../inference";
import {
  PlaywrightCommandException,
  PlaywrightCommandMethodNotSupportedException,
} from "../types";
import { Locator, Page } from "@playwright/test";
import { ActionCache } from "../cache/ActionCache";
import { modelsWithVision } from "../llm/LLMClient";
import { generateId } from "../utils";

export class StagehandActHandler {
  private readonly stagehand: Stagehand;
  private readonly verbose: 0 | 1 | 2;
  private readonly llmProvider: LLMProvider;
  private readonly enableCaching: boolean;
  private readonly logger: (log: {
    category: string;
    message: string;
    level: 0 | 1 | 2;
  }) => void;
  private readonly waitForSettledDom: (
    domSettleTimeoutMs?: number,
  ) => Promise<void>;
  private readonly actionCache: ActionCache;
  private readonly defaultModelName: AvailableModel;
  private readonly startDomDebug: () => Promise<void>;
  private readonly cleanupDomDebug: () => Promise<void>;
  private actions: { [key: string]: { result: string; action: string } };

  constructor({
    stagehand,
    verbose,
    llmProvider,
    enableCaching,
    logger,
    waitForSettledDom,
    defaultModelName,
    startDomDebug,
    cleanupDomDebug,
  }: {
    stagehand: Stagehand;
    verbose: 0 | 1 | 2;
    llmProvider: LLMProvider;
    enableCaching: boolean;
    logger: (log: {
      category: string;
      message: string;
      level: 0 | 1 | 2;
    }) => void;
    waitForSettledDom: (domSettleTimeoutMs?: number) => Promise<void>;
    defaultModelName: AvailableModel;
    startDomDebug: () => Promise<void>;
    cleanupDomDebug: () => Promise<void>;
  }) {
    this.stagehand = stagehand;
    this.verbose = verbose;
    this.llmProvider = llmProvider;
    this.enableCaching = enableCaching;
    this.logger = logger;
    this.waitForSettledDom = waitForSettledDom;
    this.actionCache = new ActionCache(this.logger, enableCaching);
    this.defaultModelName = defaultModelName;
    this.startDomDebug = startDomDebug;
    this.cleanupDomDebug = cleanupDomDebug;
    this.actions = {};
  }

  private async _recordAction(action: string, result: string): Promise<string> {
    const id = generateId(action);

    this.actions[id] = { result, action };

    return id;
  }

  private async _verifyActionCompletion({
    completed,
    verifierUseVision,
    requestId,
    action,
    steps,
    model,
    domSettleTimeoutMs,
  }: {
    completed: boolean;
    verifierUseVision: boolean;
    requestId: string;
    action: string;
    steps: string;
    model: AvailableModel;
    domSettleTimeoutMs?: number;
  }): Promise<boolean> {
    await this.waitForSettledDom(domSettleTimeoutMs);

    const { selectorMap } = await this.stagehand.page.evaluate(() => {
      return window.processAllOfDom();
    });

    let actionCompleted = false;
    if (completed) {
      // Run action completion verifier
      this.stagehand.log({
        category: "action",
        message: `Action marked as completed, Verifying if this is true...`,
        level: 1,
      });

      let domElements: string | undefined = undefined;
      let fullpageScreenshot: Buffer | undefined = undefined;

      if (verifierUseVision) {
        try {
          const screenshotService = new ScreenshotService(
            this.stagehand.page,
            selectorMap,
            this.verbose,
          );

          fullpageScreenshot = await screenshotService.getScreenshot(true, 15);
        } catch (e) {
          this.stagehand.log({
            category: "action",
            message: `Error getting full page screenshot: ${e.message}\n. Trying again...`,
            level: 1,
          });

          const screenshotService = new ScreenshotService(
            this.stagehand.page,
            selectorMap,
            this.verbose,
          );

          fullpageScreenshot = await screenshotService.getScreenshot(true, 15);
        }
      } else {
        ({ outputString: domElements } = await this.stagehand.page.evaluate(
          () => {
            return window.processAllOfDom();
          },
        ));
      }

      actionCompleted = await verifyActCompletion({
        goal: action,
        steps,
        llmProvider: this.llmProvider,
        modelName: model,
        screenshot: fullpageScreenshot,
        domElements,
        logger: this.logger,
        requestId,
      });

      this.stagehand.log({
        category: "action",
        message: `Action completion verification result: ${actionCompleted}`,
        level: 1,
      });
    }

    return actionCompleted;
  }

  private async _performPlaywrightMethod(
    method: string,
    args: string[],
    xpath: string,
    domSettleTimeoutMs?: number,
  ) {
    const locator = this.stagehand.page.locator(`xpath=${xpath}`).first();
    const initialUrl = this.stagehand.page.url();
    if (method === "scrollIntoView") {
      this.stagehand.log({
        category: "action",
        message: `Scrolling element into view`,
        level: 2,
      });
      try {
        await locator
          .evaluate((element: any) => {
            element.scrollIntoView({ behavior: "smooth", block: "center" });
          })
          .catch((e: Error) => {
            this.stagehand.log({
              category: "action",
              message: `Error scrolling element into view: ${e.message}\nTrace: ${e.stack}`,
              level: 1,
            });
          });
      } catch (e) {
        this.stagehand.log({
          category: "action",
          message: `Error scrolling element into view: ${e.message}\nTrace: ${e.stack}`,
          level: 1,
        });

        throw new PlaywrightCommandException(e.message);
      }
    } else if (method === "fill" || method === "type") {
      try {
        await locator.fill("");
        await locator.click();
        const text = args[0];
        for (const char of text) {
          await this.stagehand.page.keyboard.type(char, {
            delay: Math.random() * 50 + 25,
          });
        }
      } catch (e) {
        this.logger({
          category: "action",
          message: `Error filling element: ${e.message}\nTrace: ${e.stack}`,
          level: 1,
        });

        throw new PlaywrightCommandException(e.message);
      }
    } else if (method === "press") {
      try {
        const key = args[0];
        await this.stagehand.page.keyboard.press(key);
      } catch (e) {
        this.logger({
          category: "action",
          message: `Error pressing key: ${e.message}\nTrace: ${e.stack}`,
          level: 1,
        });

        throw new PlaywrightCommandException(e.message);
      }
    } else if (typeof locator[method as keyof typeof locator] === "function") {
      // Log current URL before action
      this.logger({
        category: "action",
        message: `Page URL before action: ${this.stagehand.page.url()}`,
        level: 2,
      });

      // Perform the action
      try {
        // @ts-ignore
        await locator[method](...args);
      } catch (e) {
        this.logger({
          category: "action",
          message: `Error performing method ${method} with args ${JSON.stringify(
            args,
          )}: ${e.message}\nTrace: ${e.stack}`,
          level: 1,
        });

        throw new PlaywrightCommandException(e.message);
      }

      // Handle navigation if a new page is opened
      if (method === "click") {
        this.logger({
          category: "action",
          message: `Clicking element, checking for page navigation`,
          level: 1,
        });

        // NAVIDNOTE: Should this happen before we wait for locator[method]?
        const newOpenedTab = await Promise.race([
          new Promise<Page | null>((resolve) => {
            this.stagehand.context.once("page", (page) => resolve(page));
            setTimeout(() => resolve(null), 1_500);
          }),
        ]);

        this.logger({
          category: "action",
          message: `Clicked element, ${newOpenedTab ? "opened a new tab" : "no new tabs opened"
            }`,
          level: 1,
        });

        if (newOpenedTab) {
          this.logger({
            category: "action",
            message: `New page detected (new tab) with URL: ${newOpenedTab.url()}`,
            level: 1,
          });
          await newOpenedTab.close();
          await this.stagehand.page.goto(newOpenedTab.url());
          await this.stagehand.page.waitForLoadState("domcontentloaded");
          await this.waitForSettledDom(domSettleTimeoutMs);
        }

        // Wait for the network to be idle with timeout of 5s (will only wait if loading a new page)
        // await this.waitForSettledDom(domSettleTimeoutMs);
        await Promise.race([
          this.stagehand.page.waitForLoadState("networkidle"),
          new Promise((resolve) => setTimeout(resolve, 5_000)),
        ]).catch((e: Error) => {
          this.logger({
            category: "action",
            message: `Network idle timeout hit`,
            level: 1,
          });
        });

        this.logger({
          category: "action",
          message: `Finished waiting for (possible) page navigation`,
          level: 1,
        });

        if (this.stagehand.page.url() !== initialUrl) {
          this.logger({
            category: "action",
            message: `New page detected with URL: ${this.stagehand.page.url()}`,
            level: 1,
          });
        }
      }
    } else {
      this.logger({
        category: "action",
        message: `Chosen method ${method} is invalid`,
        level: 1,
      });

      throw new PlaywrightCommandMethodNotSupportedException(
        `Method ${method} not supported`,
      );
    }

    await this.waitForSettledDom(domSettleTimeoutMs);
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
      const element = this.stagehand.page.locator(`xpath=${xpath}`).first();
      await element.waitFor({ state: "attached", timeout });
      return element;
    } catch {
      this.logger({
        category: "action",
        message: `Element with XPath ${xpath} not found within ${timeout}ms.`,
        level: 1,
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
      message: `Checking if cached step is valid: ${cachedStep.xpath}, ${cachedStep.savedComponentString}`,
      level: 1,
    });
    try {
      const locator = await this.getElement(cachedStep.xpath);
      if (!locator) {
        this.logger({
          category: "action",
          message: `Locator not found for xpath: ${cachedStep.xpath}`,
          level: 1,
        });
        return false;
      }

      this.logger({
        category: "action",
        message: `locator element: ${await this._getComponentString(locator)}`,
        level: 1,
      });

      // First try to get the value (for input/textarea elements)
      let currentComponent = await this._getComponentString(locator);

      this.logger({
        category: "action",
        message: `Current text: ${currentComponent}`,
        level: 1,
      });

      if (!currentComponent || !cachedStep.savedComponentString) {
        this.logger({
          category: "action",
          message: `Current text or cached text is undefined`,
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
          message: `Current text and cached text do not match: ${normalizedCurrentText} !== ${normalizedCachedText}`,
          level: 1,
        });
        return false;
      }

      return true;
    } catch (e) {
      this.logger({
        category: "action",
        message: `Error checking if cached step is valid: ${e.message}\nTrace: ${e.stack}`,
        level: 1,
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
    modelName,
    useVision,
    verifierUseVision,
    retries,
    variables,
    model,
    domSettleTimeoutMs,
  }: {
    action: string;
    previousSelectors: string[];
    requestId: string;
    steps: string;
    chunksSeen: number[];
    modelName: AvailableModel;
    useVision: boolean | "fallback";
    verifierUseVision: boolean;
    retries: number;
    variables: Record<string, string>;
    model: AvailableModel;
    domSettleTimeoutMs?: number;
  }) {
    const cacheObj = {
      url: this.stagehand.page.url(),
      action,
      previousSelectors,
      requestId,
    };

    this.logger({
      category: "action",
      message: `Checking action cache for: ${JSON.stringify(cacheObj)}`,
      level: 1,
    });

    const cachedStep = await this.actionCache.getActionStep(cacheObj);

    if (!cachedStep) {
      this.logger({
        category: "action",
        message: `Action cache miss: ${JSON.stringify(cacheObj)}`,
        level: 1,
      });
      return null;
    }

    this.logger({
      category: "action",
      message: `Action cache semi-hit: ${cachedStep.playwrightCommand.method} with args: ${JSON.stringify(
        cachedStep.playwrightCommand.args,
      )}`,
      level: 1,
    });

    try {
      const validXpath = await this._getValidCachedStepXpath({
        xpaths: cachedStep.xpaths,
        savedComponentString: cachedStep.componentString,
      });

      this.logger({
        category: "action",
        message: `Cached action step is valid: ${validXpath !== null}`,
        level: 1,
      });

      if (!validXpath) {
        this.logger({
          category: "action",
          message: `Cached action step is invalid, removing...`,
          level: 1,
        });

        await this.actionCache.removeActionStep(cacheObj);
        return null;
      }

      this.logger({
        category: "action",
        message: `Action Cache Hit: ${cachedStep.playwrightCommand.method} with args: ${JSON.stringify(
          cachedStep.playwrightCommand.args,
        )}`,
        level: 1,
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
      const { outputString, selectorMap } = await this.stagehand.page.evaluate(
        ({ chunksSeen }: { chunksSeen: number[] }) => {
          // @ts-ignore
          return window.processDom(chunksSeen);
        },
        { chunksSeen },
      );

      if (cachedStep.completed) {
        // Verify the action was completed successfully
        let actionCompleted = await this._verifyActionCompletion({
          completed: true,
          verifierUseVision,
          model,
          steps,
          requestId,
          action,
          domSettleTimeoutMs,
        });

        this.logger({
          category: "action",
          message: `Action completion verification result from cache: ${actionCompleted}`,
          level: 1,
        });

        if (actionCompleted) {
          return {
            success: true,
            message: "Action completed successfully using cached step",
            action,
          };
        }
      }

      return this.act({
        action,
        steps,
        chunksSeen,
        modelName,
        useVision,
        verifierUseVision,
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
        message: `Error performing cached action step: ${exception.message}\nTrace: ${exception.stack}`,
        level: 1,
      });

      await this.actionCache.removeActionStep(cacheObj);
      return null;
    }
  }

  public async act({
    action,
    steps = "",
    chunksSeen,
    modelName,
    useVision,
    verifierUseVision,
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
    modelName?: AvailableModel;
    useVision: boolean | "fallback";
    verifierUseVision: boolean;
    retries?: number;
    requestId?: string;
    variables: Record<string, string>;
    previousSelectors: string[];
    skipActionCacheForThisStep: boolean;
    domSettleTimeoutMs?: number;
  }): Promise<{ success: boolean; message: string; action: string }> {
    try {
      await this.waitForSettledDom(domSettleTimeoutMs);

      await this.startDomDebug();

      const model = modelName ?? this.defaultModelName;

      if (this.enableCaching && !skipActionCacheForThisStep) {
        const response = await this._runCachedActionIfAvailable({
          action,
          previousSelectors,
          requestId,
          steps,
          chunksSeen,
          modelName: model,
          useVision,
          verifierUseVision,
          retries,
          variables,
          model,
          domSettleTimeoutMs,
        });

        if (response !== null) {
          return response;
        } else {
          return this.act({
            action,
            steps,
            chunksSeen,
            modelName,
            useVision,
            verifierUseVision,
            retries,
            requestId,
            variables,
            previousSelectors,
            skipActionCacheForThisStep: true,
            domSettleTimeoutMs,
          });
        }
      }

      if (
        !modelsWithVision.includes(model) &&
        (useVision !== false || verifierUseVision)
      ) {
        this.logger({
          category: "action",
          message: `${model} does not support vision, but useVision was set to ${useVision}. Defaulting to false.`,
          level: 1,
        });
        useVision = false;
        verifierUseVision = false;
      }

      this.logger({
        category: "action",
        message: `Running / Continuing action: ${action} on page: ${this.stagehand.page.url()}`,
        level: 2,
      });

      this.logger({
        category: "action",
        message: `Processing DOM...`,
        level: 2,
      });

      const { outputString, selectorMap, chunk, chunks } =
        await this.stagehand.page.evaluate(
          ({ chunksSeen }: { chunksSeen: number[] }) => {
            // @ts-ignore
            return window.processDom(chunksSeen);
          },
          { chunksSeen },
        );

      this.logger({
        category: "action",
        message: `Looking at chunk ${chunk}. Chunks left: ${chunks.length - chunksSeen.length
          }`,
        level: 1,
      });

      // Prepare annotated screenshot if vision is enabled
      let annotatedScreenshot: Buffer | undefined;
      if (useVision === true) {
        if (!modelsWithVision.includes(model)) {
          this.logger({
            category: "action",
            message: `${model} does not support vision. Skipping vision processing.`,
            level: 1,
          });
        } else {
          const screenshotService = new ScreenshotService(
            this.stagehand.page,
            selectorMap,
            this.verbose,
          );

          annotatedScreenshot =
            await screenshotService.getAnnotatedScreenshot(false);
        }
      }

      const response = await act({
        action,
        domElements: outputString,
        steps,
        llmProvider: this.llmProvider,
        modelName: model,
        screenshot: annotatedScreenshot,
        logger: this.logger,
        requestId,
        variables,
      });

      this.logger({
        category: "action",
        message: `Received response from LLM: ${JSON.stringify(response)}`,
        level: 1,
      });

      await this.cleanupDomDebug();

      if (!response) {
        if (chunksSeen.length + 1 < chunks.length) {
          chunksSeen.push(chunk);

          this.logger({
            category: "action",
            message: `No action found in current chunk. Chunks seen: ${chunksSeen.length}.`,
            level: 1,
          });

          return this.act({
            action,
            steps:
              steps +
              (!steps.endsWith("\n") ? "\n" : "") +
              "## Step: Scrolled to another section\n",
            chunksSeen,
            modelName,
            useVision,
            verifierUseVision,
            requestId,
            variables,
            previousSelectors,
            skipActionCacheForThisStep,
            domSettleTimeoutMs,
          });
        } else if (useVision === "fallback") {
          this.logger({
            category: "action",
            message: `Switching to vision-based processing`,
            level: 1,
          });
          await this.stagehand.page.evaluate(() => window.scrollToHeight(0));
          return await this.act({
            action,
            steps,
            chunksSeen,
            modelName,
            useVision: true,
            verifierUseVision,
            requestId,
            variables,
            previousSelectors,
            skipActionCacheForThisStep,
            domSettleTimeoutMs,
          });
        } else {
          if (this.enableCaching) {
            this.llmProvider.cleanRequestCache(requestId);
            this.actionCache.deleteCacheForRequestId(requestId);
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
        message: `Executing method: ${method} on element: ${elementId} (xpaths: ${xpaths.join(
          ", ",
        )}) with args: ${JSON.stringify(args)}`,
        level: 1,
      });

      try {
        const initialUrl = this.stagehand.page.url();
        const locator = this.stagehand.page
          .locator(`xpath=${xpaths[0]}`)
          .first();
        const originalUrl = this.stagehand.page.url();
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
          xpaths[0],
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
                args: responseArgs,
              },
              componentString,
              requestId,
              xpaths: xpaths,
              newStepString,
              completed: response.completed,
            })
            .catch((e) => {
              this.logger({
                category: "action",
                message: `Error adding action step to cache: ${e.message}\nTrace: ${e.stack}`,
                level: 1,
              });
            });
        }

        if (this.stagehand.page.url() !== initialUrl) {
          steps += `  Result (Important): Page URL changed from ${initialUrl} to ${this.stagehand.page.url()}\n\n`;
        }

        const actionCompleted = await this._verifyActionCompletion({
          completed: response.completed,
          verifierUseVision,
          requestId,
          action,
          steps,
          model,
          domSettleTimeoutMs,
        });

        if (!actionCompleted) {
          this.logger({
            category: "action",
            message: `Continuing to next action step`,
            level: 1,
          });

          return this.act({
            action,
            steps,
            modelName,
            chunksSeen,
            useVision,
            verifierUseVision,
            requestId,
            variables,
            previousSelectors: [...previousSelectors, xpaths[0]],
            skipActionCacheForThisStep: false,
            domSettleTimeoutMs,
          });
        } else {
          this.logger({
            category: "action",
            message: `Action completed successfully`,
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
          message: `Error performing action - D (Retries: ${retries}): ${error.message}\nTrace: ${error.stack}`,
          level: 1,
        });

        if (retries < 2) {
          return this.act({
            action,
            steps,
            modelName,
            useVision,
            verifierUseVision,
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
          message: `Error performing action - A: ${error.message}`,
          action: action,
        };
      }
    } catch (error) {
      this.logger({
        category: "action",
        message: `Error performing action - B: ${error.message}\nTrace: ${error.stack}`,
        level: 1,
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

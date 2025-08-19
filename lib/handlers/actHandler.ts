import { Locator } from "playwright";
import { LogLine } from "../../types/log";
import {
  PlaywrightCommandException,
  PlaywrightCommandMethodNotSupportedException,
} from "../../types/playwright";
import { LLMClient } from "../llm/LLMClient";
import { StagehandPage } from "../StagehandPage";
import {
  ActResult,
  ObserveResult,
  ActOptions,
  ObserveOptions,
} from "@/types/stagehand";
import { MethodHandlerContext, SupportedPlaywrightAction } from "@/types/act";
import { buildActObservePrompt } from "../prompt";
import {
  methodHandlerMap,
  fallbackLocatorMethod,
  deepLocator,
  deepLocatorWithShadow,
} from "./handlerUtils/actHandlerUtils";
import { StagehandObserveHandler } from "@/lib/handlers/observeHandler";
import { StagehandInvalidArgumentError } from "@/types/stagehandErrors";
/**
 * NOTE: Vision support has been removed from this version of Stagehand.
 * If useVision or verifierUseVision is set to true, a warning is logged and
 * the flow continues as if vision = false.
 */
export class StagehandActHandler {
  private readonly stagehandPage: StagehandPage;
  private readonly logger: (logLine: LogLine) => void;
  private readonly selfHeal: boolean;
  private readonly experimental: boolean;

  constructor({
    logger,
    stagehandPage,
    selfHeal,
    experimental,
  }: {
    logger: (logLine: LogLine) => void;
    stagehandPage: StagehandPage;
    selfHeal: boolean;
    experimental: boolean;
  }) {
    this.logger = logger;
    this.stagehandPage = stagehandPage;
    this.selfHeal = selfHeal;
    this.experimental = experimental;
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
      // We will try to use observeAct on a failed ObserveResult-act if selfHeal is true
      this.logger({
        category: "action",
        message:
          "Error performing act from an ObserveResult. Reprocessing the page and trying again",
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
        const instruction = buildActObservePrompt(
          actCommand,
          Object.values(SupportedPlaywrightAction),
          {},
        );
        const observeResults = await this.stagehandPage.observe({
          instruction,
        });
        if (observeResults.length === 0) {
          return {
            success: false,
            message: `Failed to self heal act: No observe results found for action`,
            action: actCommand,
          };
        }
        const element: ObserveResult = observeResults[0];
        await this._performPlaywrightMethod(
          // override previously provided method and arguments
          observe.method,
          observe.arguments,
          // only update selector
          element.selector,
          domSettleTimeoutMs,
        );
        return {
          success: true,
          message: `Action [${element.method}] performed successfully on selector: ${element.selector}`,
          action: observe.description || `ObserveResult action (${method})`,
        };
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

    // doObserveAndAct is just a wrapper of observeAct and actFromObserveResult.
    // we did this so that we can cleanly call a Promise.race, and race
    // doObserveAndAct against the user defined timeoutMs (if one was defined)
    const doObserveAndAct = async (): Promise<ActResult> => {
      const instruction = buildActObservePrompt(
        action,
        Object.values(SupportedPlaywrightAction),
        actionOrOptions.variables,
      );

      const observeResults = await observeHandler.observe({
        instruction,
        llmClient,
        requestId,
        drawOverlay: false,
        returnAction: true,
        fromAct: true,
        iframes: actionOrOptions?.iframes,
      });

      if (observeResults.length === 0) {
        return {
          success: false,
          message: `Failed to perform act: No observe results found for action`,
          action,
        };
      }

      const element: ObserveResult = observeResults[0];

      if (actionOrOptions.variables) {
        Object.keys(actionOrOptions.variables).forEach((key) => {
          element.arguments = element.arguments.map((arg) =>
            arg.replace(`%${key}%`, actionOrOptions.variables![key]),
          );
        });
      }

      return this.actFromObserveResult(
        element,
        actionOrOptions.domSettleTimeoutMs,
      );
    };

    // if no user defined timeoutMs, just do observeAct + actFromObserveResult
    // with no timeout
    if (!actionOrOptions.timeoutMs) {
      return doObserveAndAct();
    }

    // Race observeAct + actFromObserveResult vs. the timeoutMs
    const { timeoutMs } = actionOrOptions;
    return await Promise.race([
      doObserveAndAct(),
      new Promise<ActResult>((resolve) => {
        setTimeout(() => {
          resolve({
            success: false,
            message: `Action timed out after ${timeoutMs}ms`,
            action,
          });
        }, timeoutMs);
      }),
    ]);
  }

  private async _performPlaywrightMethod(
    method: string,
    args: unknown[],
    rawXPath: string,
    domSettleTimeoutMs?: number,
  ) {
    const xpath = rawXPath.replace(/^xpath=/i, "").trim();
    let locator;
    if (this.experimental) {
      locator = await deepLocatorWithShadow(this.stagehandPage.page, xpath);
    } else {
      locator = deepLocator(this.stagehandPage.page, xpath);
    }

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
}

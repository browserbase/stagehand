import type { Action, ActResultData, Variables } from "@browserbasehq/stagehand-protocol/types";
import { TimeoutError } from "../../errors.js";
import { performUnderstudyMethod } from "../../handlers/handlerUtils/actHandlerUtils.js";
import { resolveVariableValue } from "../../handlers/handlerUtils/variables.js";
import type { StagehandLogger } from "../../logger.js";
import { buildActPrompt } from "../../prompt.js";
import { SupportedUnderstudyAction } from "../../types/private/handlers.js";
import type { Page } from "../../understudy/page.js";
import { inferAction } from "./llm/act.js";
import type { ActRequest, LlmPort } from "./types.js";

export type ActionRunnerEnvironment = {
  page: Page;
  logger: StagehandLogger;
  llm: LlmPort;
  variables?: Variables;
  /** Whether a failed action is re-inferred once and retried, unless the caller says otherwise. */
  selfHeal: boolean;
  domSettleTimeoutMs?: number;
  ensureTimeRemaining: () => void;
};

/**
 * Performs actions on the page: variable substitution, the understudy call, and one self-heal
 * retry (re-find the element by its description) when enabled. Every driver acts through this,
 * so an action behaves the same whoever chose it.
 */
export function createActionRunner(environment: ActionRunnerEnvironment): ActRequest["runAction"] {
  const { page, logger, variables, domSettleTimeoutMs, ensureTimeRemaining } = environment;

  return async function runAction(action, options) {
    ensureTimeRemaining();
    const method = action.method?.trim();
    if (!method || method === "not-supported") {
      logger.error("Action has no supported method", {
        category: "action",
        action: JSON.stringify(action),
      });
      return {
        success: false,
        message: `Unable to perform action: The method '${method ?? ""}' is not supported in Action. Please use a supported Playwright locator method.`,
        actionDescription: action.description || `Action (${method ?? "unknown"})`,
        actions: [],
      };
    }

    const placeholderArgs = Array.isArray(action.arguments) ? [...action.arguments] : [];
    const resolvedArgs = substituteVariables(action.arguments, variables) ?? [];
    const perform = async (selector: string): Promise<void> => {
      ensureTimeRemaining();
      await performUnderstudyMethod(
        page,
        page.mainFrame(),
        method,
        selector,
        resolvedArgs,
        logger,
        domSettleTimeoutMs,
      );
    };

    try {
      await perform(action.selector);
      return succeeded(action, method, action.selector, placeholderArgs);
    } catch (error) {
      if (error instanceof TimeoutError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      if (!(options?.selfHeal ?? environment.selfHeal)) {
        return {
          success: false,
          message: `Failed to perform act: ${message}`,
          actionDescription: action.description || `action (${method})`,
          actions: [],
        };
      }

      logger.debug("Error performing action; reprocessing the page and trying again", {
        category: "action",
        error: message,
        action: JSON.stringify(action),
      });
      return await selfHeal(action, method, placeholderArgs, perform);
    }
  };

  async function selfHeal(
    action: Action,
    method: string,
    placeholderArgs: string[],
    perform: (selector: string) => Promise<void>,
  ): Promise<ActResultData> {
    const instruction = action.description
      ? action.description.toLowerCase().startsWith(method.toLowerCase())
        ? action.description
        : `${method} ${action.description}`
      : method;

    try {
      ensureTimeRemaining();
      const { combinedTree, combinedXpathMap } = await page.captureSnapshot({});
      const inferred = await inferAction(
        environment,
        buildActPrompt(instruction, Object.values(SupportedUnderstudyAction), {}),
        combinedTree,
        combinedXpathMap,
      );
      if (!inferred.response.element) {
        return {
          success: false,
          message: "Failed to self-heal act: No observe results found for action",
          actionDescription: instruction,
          actions: [],
        };
      }

      const selector = inferred.action?.selector ?? action.selector;
      await perform(selector);
      return succeeded(action, method, selector, placeholderArgs);
    } catch (error) {
      if (error instanceof TimeoutError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Failed to perform act after self-heal: ${message}`,
        actionDescription: action.description || `action (${method})`,
        actions: [],
      };
    }
  }
}

function substituteVariables(
  args: string[] | undefined,
  variables?: Variables,
): string[] | undefined {
  if (!variables || !Array.isArray(args)) return args;

  return args.map((arg) => {
    let output = arg;
    for (const [key, value] of Object.entries(variables)) {
      output = output.split(`%${key}%`).join(resolveVariableValue(value));
    }
    return output;
  });
}

function succeeded(
  action: Action,
  method: string,
  selector: string,
  arguments_: string[],
): ActResultData {
  return {
    success: true,
    message: `Action [${method}] performed successfully on selector: ${selector}`,
    actionDescription: action.description || `action (${method})`,
    actions: [
      {
        selector,
        description: action.description || `action (${method})`,
        method,
        arguments: arguments_,
      },
    ],
  };
}

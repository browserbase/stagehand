import type { Action, ActResultData, Variables } from "@browserbasehq/stagehand-protocol/types";
import { TimeoutError } from "../../errors.js";
import { performUnderstudyMethod } from "../../handlers/handlerUtils/actHandlerUtils.js";
import { buildActPrompt } from "../../prompt.js";
import { SupportedUnderstudyAction } from "../../types/private/handlers.js";
import type { Page } from "../../understudy/page.js";
import { guardActionTarget } from "../decisions/actionGuard.js";
import { substituteVariables } from "../decisions/args.js";
import { fillSelected } from "../decisions/fill.js";
import { getActionFromLLM, type ActInferenceContext } from "./inference.js";

export type ActContext = ActInferenceContext & {
  selfHeal: boolean;
  domSettleTimeoutMs?: number;
  snapshotOptions: Parameters<Page["captureSnapshot"]>[0];
};

export async function takeDeterministicAction({
  action,
  variables,
  context,
  expectedElementId,
  expectedDestinationElementId,
}: {
  action: Action;
  variables?: Variables;
  context: ActContext;
  expectedElementId?: string;
  expectedDestinationElementId?: string;
}): Promise<ActResultData> {
  context.progress.throwIfStopped();
  const method = action.method?.trim();
  if (!method || method === "not-supported") {
    context.logger.error("Action has no supported method", {
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
  // Drag arguments are selectors, not text templates; page-controlled names must stay literal.
  const resolvedArgs =
    method === SupportedUnderstudyAction.DRAG_AND_DROP
      ? placeholderArgs
      : (substituteVariablesInArguments(action.arguments, variables) ?? []);

  if (context.decisions) {
    const rejection = await guardActionTarget(
      context.page,
      action,
      context.progress,
      expectedElementId,
      expectedDestinationElementId,
    );
    if (
      rejection &&
      context.selfHeal &&
      (rejection === "target_unresolved" || rejection === "target_replaced")
    ) {
      return selfHealAction({ action, method, resolvedArgs, placeholderArgs, context });
    }
    if (rejection)
      return {
        success: false,
        message: `Failed to perform act: ${rejection}`,
        actionDescription: action.description,
        actions: [],
      };
  }

  try {
    context.progress.throwIfStopped();
    await dispatchActMethod(context, method, action.selector, resolvedArgs, expectedElementId);
    return successfulActionResult(action, method, action.selector, placeholderArgs);
  } catch (error) {
    context.progress.throwIfStopped();
    if (error instanceof TimeoutError) throw error;
    const message = error instanceof Error ? error.message : String(error);

    if (!context.selfHeal || context.decisions) {
      return {
        success: false,
        message: `Failed to perform act: ${message}`,
        actionDescription: action.description || `action (${method})`,
        actions: context.decisions ? [action] : [],
      };
    }

    context.logger.debug("Error performing action; reprocessing the page and trying again", {
      category: "action",
      error: message,
      action: JSON.stringify(action),
    });
    return await selfHealAction({
      action,
      method,
      resolvedArgs,
      placeholderArgs,
      context,
    });
  }
}

async function dispatchActMethod(
  context: ActContext,
  method: string,
  selector: string,
  args: string[],
  expectedElementId?: string,
): Promise<void> {
  if (context.decisions && method === "fill") {
    await fillSelected(context.page, selector, expectedElementId, args[0] ?? "", context.progress);
    return;
  }
  await performUnderstudyMethod(
    context.page,
    context.page.mainFrame(),
    method,
    selector,
    args,
    context.logger,
    context.progress,
    context.domSettleTimeoutMs,
  );
}

async function selfHealAction({
  action,
  method,
  resolvedArgs,
  placeholderArgs,
  context,
}: {
  action: Action;
  method: string;
  resolvedArgs: string[];
  placeholderArgs: string[];
  context: ActContext;
}): Promise<ActResultData> {
  const actionInstruction = action.description
    ? action.description.toLowerCase().startsWith(method.toLowerCase())
      ? action.description
      : `${method} ${action.description}`
    : method;

  let attempted: Action | undefined;
  try {
    context.progress.throwIfStopped();
    const snapshot = await context.page.captureSnapshot(
      context.decisions ? context.snapshotOptions : {},
      context.progress,
    );
    const inferenceResult = await getActionFromLLM({
      instruction: buildActPrompt(actionInstruction, Object.values(SupportedUnderstudyAction), {}),
      domElements: snapshot.combinedTree,
      snapshot,
      context,
    });

    if (!inferenceResult.response.element || (context.decisions && !inferenceResult.action)) {
      return {
        success: false,
        message: "Failed to self-heal act: No observe results found for action",
        actionDescription: actionInstruction,
        actions: [],
      };
    }

    const selector = inferenceResult.action?.selector ?? action.selector;
    // A healed drag needs both fresh selectors. Text arguments retain the caller's original values.
    if (context.decisions && method === SupportedUnderstudyAction.DRAG_AND_DROP) {
      if (inferenceResult.action?.method !== method)
        return {
          success: false,
          message: "Failed to self-heal act: No drag target found",
          actionDescription: actionInstruction,
          actions: [],
        };
      resolvedArgs = inferenceResult.action.arguments ?? [];
      placeholderArgs = [...resolvedArgs];
    }
    context.progress.throwIfStopped();
    if (context.decisions) {
      const rejection = await guardActionTarget(
        context.page,
        { ...action, method, selector, arguments: placeholderArgs },
        context.progress,
        inferenceResult.expectedElementId,
        method === SupportedUnderstudyAction.DRAG_AND_DROP
          ? inferenceResult.expectedDestinationElementId
          : undefined,
      );
      if (rejection)
        return {
          success: false,
          message: `Failed to self-heal act: ${rejection}`,
          actionDescription: action.description,
          actions: [],
        };
    }
    attempted = { ...action, method, selector, arguments: placeholderArgs };
    await dispatchActMethod(
      context,
      method,
      selector,
      resolvedArgs,
      inferenceResult.expectedElementId,
    );
    return successfulActionResult(action, method, selector, placeholderArgs);
  } catch (error) {
    context.progress.throwIfStopped();
    if (error instanceof TimeoutError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      message: `Failed to perform act after self-heal: ${message}`,
      actionDescription: action.description || `action (${method})`,
      actions: context.decisions && attempted ? [attempted] : [],
    };
  }
}

function substituteVariablesInArguments(
  args: string[] | undefined,
  variables?: Variables,
): string[] | undefined {
  if (!variables || !Array.isArray(args)) return args;

  return args.map((arg) => substituteVariables(arg, variables));
}

function successfulActionResult(
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

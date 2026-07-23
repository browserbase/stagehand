import type {
  ActResult,
  ActResultData,
  Action,
  ClientModelReference,
  ModelConfig,
  StagehandActParams,
  Variables,
} from "../../protocol/types.js";
import { TimeoutError } from "../errors.js";
import {
  performUnderstudyMethod,
  waitForDomNetworkQuiet,
} from "../handlers/handlerUtils/actHandlerUtils.js";
import { createTimeoutGuard } from "../handlers/handlerUtils/timeoutGuard.js";
import { resolveVariableValue } from "../handlers/handlerUtils/variables.js";
import * as inference from "../inference.js";
import type { ClientLlmRequest } from "../llm/clientLlmClient.js";
import type { StagehandLogger } from "../logger.js";
import { buildActPrompt, buildStepTwoPrompt } from "../prompt.js";
import type { EncodedId } from "../types/private/internal.js";
import { SupportedUnderstudyAction } from "../types/private/handlers.js";
import { diffCombinedTrees } from "../understudy/a11y/snapshot/index.js";
import type { Page } from "../understudy/page.js";
import { trimTrailingTextNode } from "../utils.js";
import * as cacheService from "./cacheService.js";
import * as llmService from "./llmService.js";

type ActInferenceResponse = Awaited<ReturnType<typeof inference.act>>;
type ActInferenceElement = NonNullable<ActInferenceResponse["element"]>;

type ActContext = {
  page: Page;
  model: ModelConfig | ClientModelReference;
  clientLLMGenerate: ClientLlmRequest;
  logger: StagehandLogger;
  systemPrompt: string;
  selfHeal: boolean;
  domSettleTimeoutMs?: number;
  ensureTimeRemaining: () => void;
};

export async function act({
  params,
  page,
  model,
  clientLLMGenerate,
  logger,
  systemPrompt = "",
  selfHeal = false,
  domSettleTimeoutMs,
  cache,
}: {
  params: StagehandActParams;
  page: Page;
  model: ModelConfig | ClientModelReference;
  clientLLMGenerate: ClientLlmRequest;
  logger: StagehandLogger;
  systemPrompt?: string;
  selfHeal?: boolean;
  domSettleTimeoutMs?: number;
  cache?: cacheService.CacheContext;
}): Promise<ActResult> {
  const { input, options } = params;
  const variables = options?.variables;
  const timeout = options?.timeout;
  const ensureTimeRemaining = createTimeoutGuard(timeout, (ms) => new TimeoutError("act()", ms));
  const context: ActContext = {
    page,
    model,
    clientLLMGenerate,
    logger,
    systemPrompt,
    selfHeal,
    domSettleTimeoutMs,
    ensureTimeRemaining,
  };

  ensureTimeRemaining();
  await waitForDomNetworkQuiet(page.mainFrame(), logger, domSettleTimeoutMs);
  ensureTimeRemaining();

  return await cacheService.withCache<ActResult>({
    method: "act",
    page,
    data: cacheService.buildActCacheData(params),
    caching: options?.cache,
    context: cache,
    logger,
    onHit: (value) => replayCachedActions(value, input, variables, context),
    execute: async () => {
      const result = await runActPipeline();
      return {
        result,
        cacheValue:
          result.result.success && result.result.actions.length > 0
            ? result.result.actions
            : undefined,
      };
    },
  });

  async function runActPipeline(): Promise<ActResult> {
    const { combinedTree, combinedXpathMap } = await page.captureSnapshot({});

    const instruction = buildActPrompt(input, Object.values(SupportedUnderstudyAction), variables);

    ensureTimeRemaining();
    const firstInference = await getActionFromLLM({
      instruction,
      domElements: combinedTree,
      xpathMap: combinedXpathMap,
      context,
    });

    if (!firstInference.action) {
      logger.info("No actionable element returned by the LLM", {
        category: "action",
      });
      return actResult({
        success: false,
        message: "Failed to perform act: No action found",
        actionDescription: input,
        actions: [],
      });
    }

    ensureTimeRemaining();
    const firstResult = await takeDeterministicAction({
      action: firstInference.action,
      variables,
      context,
    });

    if (!firstInference.response.twoStep) {
      return actResult(firstResult);
    }

    ensureTimeRemaining();
    const { combinedTree: nextTree, combinedXpathMap: nextXpathMap } = await page.captureSnapshot(
      {},
    );
    const changedTree = diffCombinedTrees(combinedTree, nextTree);
    const secondInstruction = buildStepTwoPrompt(
      input,
      describeAction(firstInference.action),
      Object.values(SupportedUnderstudyAction).filter(
        (
          action,
        ): action is Exclude<
          SupportedUnderstudyAction,
          SupportedUnderstudyAction.SELECT_OPTION_FROM_DROPDOWN
        > => action !== SupportedUnderstudyAction.SELECT_OPTION_FROM_DROPDOWN,
      ),
      variables,
    );

    ensureTimeRemaining();
    const secondInference = await getActionFromLLM({
      instruction: secondInstruction,
      domElements: changedTree.trim() ? changedTree : nextTree,
      xpathMap: nextXpathMap,
      context,
    });

    if (!secondInference.action) {
      return actResult(firstResult);
    }

    ensureTimeRemaining();
    const secondResult = await takeDeterministicAction({
      action: secondInference.action,
      variables,
      context,
    });

    return actResult({
      success: firstResult.success && secondResult.success,
      message: `${firstResult.message} → ${secondResult.message}`,
      actionDescription: firstResult.actionDescription,
      actions: [...firstResult.actions, ...secondResult.actions],
    });
  }
}

/**
 * Replays cached actions deterministically — no LLM involved. Any failure
 * throws so the cache intercept falls back to the full inference pipeline,
 * which doubles as the self-heal path for stale cached selectors.
 */
async function replayCachedActions(
  value: unknown,
  input: string,
  variables: Variables | undefined,
  context: ActContext,
): Promise<ActResult> {
  const actions = cacheService.normalizeCachedActions(value);
  if (actions.length === 0) {
    throw new Error("Cached act value contained no usable actions");
  }

  const results: ActResultData[] = [];
  for (const action of actions) {
    const result = await takeDeterministicAction({
      action,
      variables,
      context: { ...context, selfHeal: false },
    });
    if (!result.success) {
      throw new Error(result.message);
    }
    results.push(result);
  }

  return actResult({
    success: true,
    message: results.map((result) => result.message).join(" → "),
    actionDescription: input,
    actions: results.flatMap((result) => result.actions),
  });
}

async function getActionFromLLM({
  instruction,
  domElements,
  xpathMap,
  context,
}: {
  instruction: string;
  domElements: string;
  xpathMap: Record<string, string>;
  context: ActContext;
}): Promise<{ action?: Action; response: ActInferenceResponse }> {
  const response = await inference.act({
    instruction,
    domElements,
    generate: (input) => llmService.generate(context.model, input, context.clientLLMGenerate),
    userProvidedInstructions: context.systemPrompt,
  });

  context.logger.info("Act inference completed", {
    category: "action",
    promptTokens: response.prompt_tokens,
    completionTokens: response.completion_tokens,
    reasoningTokens: response.reasoning_tokens,
    cachedInputTokens: response.cached_input_tokens,
    inferenceTimeMs: response.inference_time_ms,
  });

  const action = response.element
    ? normalizeActInferenceElement(response.element, xpathMap, context.logger)
    : undefined;
  return action ? { action, response } : { response };
}

async function takeDeterministicAction({
  action,
  variables,
  context,
}: {
  action: Action;
  variables?: Variables;
  context: ActContext;
}): Promise<ActResultData> {
  context.ensureTimeRemaining();
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
  const resolvedArgs = substituteVariablesInArguments(action.arguments, variables) ?? [];

  try {
    context.ensureTimeRemaining();
    await performUnderstudyMethod(
      context.page,
      context.page.mainFrame(),
      method,
      action.selector,
      resolvedArgs,
      context.logger,
      context.domSettleTimeoutMs,
    );
    return successfulActionResult(action, method, action.selector, placeholderArgs);
  } catch (error) {
    if (error instanceof TimeoutError) throw error;
    const message = error instanceof Error ? error.message : String(error);

    if (!context.selfHeal) {
      return {
        success: false,
        message: `Failed to perform act: ${message}`,
        actionDescription: action.description || `action (${method})`,
        actions: [],
      };
    }

    context.logger.info("Error performing action; reprocessing the page and trying again", {
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

  try {
    context.ensureTimeRemaining();
    const { combinedTree, combinedXpathMap } = await context.page.captureSnapshot({});
    const inferenceResult = await getActionFromLLM({
      instruction: buildActPrompt(actionInstruction, Object.values(SupportedUnderstudyAction), {}),
      domElements: combinedTree,
      xpathMap: combinedXpathMap,
      context,
    });

    if (!inferenceResult.response.element) {
      return {
        success: false,
        message: "Failed to self-heal act: No observe results found for action",
        actionDescription: actionInstruction,
        actions: [],
      };
    }

    const selector = inferenceResult.action?.selector ?? action.selector;
    context.ensureTimeRemaining();
    await performUnderstudyMethod(
      context.page,
      context.page.mainFrame(),
      method,
      selector,
      resolvedArgs,
      context.logger,
      context.domSettleTimeoutMs,
    );
    return successfulActionResult(action, method, selector, placeholderArgs);
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

function normalizeActInferenceElement(
  element: ActInferenceElement,
  xpathMap: Record<string, string>,
  logger: StagehandLogger,
): Action | undefined {
  const xpath = trimTrailingTextNode(xpathMap[element.elementId as EncodedId]);
  if (!xpath) return undefined;

  let args = element.arguments;
  if (element.method === SupportedUnderstudyAction.DRAG_AND_DROP && args.length > 0) {
    const targetElementId = args[0];
    if (!targetElementId || !/^\d+-\d+$/.test(targetElementId)) {
      logger.error("Drag-and-drop target element has an invalid ID format", {
        category: "action",
        targetElementId: targetElementId ?? "",
        sourceElementId: element.elementId,
      });
      return undefined;
    }

    const targetXpath = trimTrailingTextNode(xpathMap[targetElementId as EncodedId]);
    if (!targetXpath) {
      logger.info("Drag-and-drop target element lookup failed", {
        category: "action",
        targetElementId,
        sourceElementId: element.elementId,
      });
      return undefined;
    }
    args = [`xpath=${targetXpath}`, ...args.slice(1)];
  }

  return {
    selector: `xpath=${xpath}`,
    description: element.description,
    method: element.method,
    arguments: args,
  };
}

function substituteVariablesInArguments(
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

function actResult(result: ActResultData): ActResult {
  return { result };
}

function describeAction(action: Action): string {
  return `method: ${action.method}, description: ${action.description}, arguments: ${action.arguments?.join(", ") ?? ""}`;
}

import type {
  ActResult,
  ActResultData,
  Action,
  ClientModelReference,
  ModelConfig,
  StagehandActParams,
  StagehandResultUsage,
  Variables,
} from "@browserbasehq/stagehand-protocol/types";
import { TimeoutError } from "../errors.js";
import {
  performUnderstudyMethod,
  waitForDomNetworkQuiet,
} from "../handlers/handlerUtils/actHandlerUtils.js";
import * as inference from "../inference.js";
import type { ClientLlmRequest } from "../llm/clientLlmClient.js";
import type { GatewayContext } from "../llm/gatewayClient.js";
import type { StagehandLogger } from "../logger.js";
import { buildActPrompt, buildStepTwoPrompt } from "../prompt.js";
import type { EncodedId } from "../types/private/internal.js";
import { SupportedUnderstudyAction } from "../types/private/handlers.js";
import { diffCombinedTrees } from "../understudy/a11y/snapshot/index.js";
import type { Page } from "../understudy/page.js";
import { type Progress, runWithProgress } from "../understudy/progress.js";
import { trimTrailingTextNode } from "../utils.js";
import * as cacheService from "./cacheService.js";
import { runDecisionsAct } from "./decisions/act.js";
import type { DecisionsConfig } from "./decisions/config.js";
import { withDecisionUsage } from "./decisions/usage.js";
import { guardActionTarget } from "./decisions/actionGuard.js";
import { readFacts } from "./decisions/actionFacts.js";
import { substituteVariables } from "./decisions/args.js";
import * as llmService from "./llmService.js";
import { disabledCacheMetadata, zeroStagehandResultUsage } from "./resultUsage.js";

type ActInferenceResponse = Awaited<ReturnType<typeof inference.act>>;
type ActInferenceElement = NonNullable<ActInferenceResponse["element"]>;

type ActContext = {
  page: Page;
  model: ModelConfig | ClientModelReference | undefined;
  clientLLMGenerate: ClientLlmRequest;
  logger: StagehandLogger;
  systemPrompt: string;
  selfHeal: boolean;
  domSettleTimeoutMs?: number;
  progress: Progress;
  gateway?: GatewayContext;
  decisions?: DecisionsConfig;
  snapshotOptions: Parameters<Page["captureSnapshot"]>[0];
  recordUsage: (response: ActInferenceResponse) => void;
};

type ActServiceOptions = {
  params: StagehandActParams;
  page: Page;
  model: ModelConfig | ClientModelReference | undefined;
  clientLLMGenerate: ClientLlmRequest;
  logger: StagehandLogger;
  systemPrompt?: string;
  selfHeal?: boolean;
  domSettleTimeoutMs?: number;
  cache?: cacheService.CacheContext;
  gateway?: GatewayContext;
  decisions?: DecisionsConfig;
  progress?: Progress;
};

export async function act(options: ActServiceOptions): Promise<ActResult> {
  return runWithProgress(
    options.progress ?? { name: "act()", timeout: options.params.options?.timeout ?? 0 },
    (progress) => actWithProgress(options, progress),
  );
}

async function actWithProgress(
  {
    params,
    page,
    model,
    clientLLMGenerate,
    logger,
    systemPrompt = "",
    selfHeal = false,
    domSettleTimeoutMs,
    cache,
    gateway,
    decisions,
  }: ActServiceOptions,
  progress: Progress,
): Promise<ActResult> {
  const { instruction: actInstruction, options } = params;
  const decisionUsage = zeroStagehandResultUsage();
  decisions = withDecisionUsage(decisions, progress.signal, logger, decisionUsage);
  const variables = options?.variables;
  const snapshotOptions = {
    focusLocator: options?.locator,
    ignoreLocators: options?.ignoreLocators,
  };
  let operationUsage = zeroStagehandResultUsage();
  const recordUsage = (response: ActInferenceResponse): void => {
    operationUsage = aggregateUsage(operationUsage, usageFromInference(response));
  };
  const context: ActContext = {
    page,
    model,
    clientLLMGenerate,
    logger,
    systemPrompt,
    selfHeal,
    domSettleTimeoutMs,
    progress,
    gateway,
    decisions,
    snapshotOptions,
    recordUsage,
  };

  progress.throwIfStopped();
  if (typeof actInstruction !== "string") {
    return actResult(
      await takeDeterministicAction({
        action: actInstruction,
        variables,
        context,
      }),
      operationUsage,
    );
  }

  const instruction = actInstruction;
  await waitForDomNetworkQuiet(page.mainFrame(), logger, domSettleTimeoutMs, progress);
  progress.throwIfStopped();

  return await cacheService.withCache<ActResult>({
    method: "act",
    page,
    data: cacheService.buildActCacheData(params),
    caching: options?.cache,
    bypass: cacheService.shouldBypassCacheForLocatorScope(options),
    context: cache,
    logger,
    progress,
    onHit: (value) => replayCachedActions(value, instruction, variables, context),
    execute: async () => {
      const result = await runActPipeline();
      const llmUsage = { ...result.metadata.usage };
      result.metadata.usage = aggregateUsage(result.metadata.usage, decisionUsage);
      // Act can run several inferences (planning, self-heal), so report the
      // aggregate — without it the server has no basis to compute the token
      // savings a future hit avoided.
      const usage = llmUsage;
      return {
        result,
        cacheValue:
          result.data.success && result.data.actions.length > 0 ? result.data.actions : undefined,
        llmUsage: {
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          llmDurationMs: usage.inferenceTimeMs,
        },
      };
    },
  });

  async function runActPipeline(): Promise<ActResult> {
    if (decisions) {
      const started = performance.now();
      const outcome = await runDecisionsAct(decisions, {
        page,
        logger,
        instruction,
        variables,
        snapshotOptions,
        progress,
        takeAction: (action, expectedElementId) =>
          takeDeterministicAction({
            action,
            variables,
            expectedElementId,
            context: { ...context, selfHeal: false },
          }),
      });
      decisionUsage.inferenceTimeMs += Math.round(performance.now() - started);
      if (outcome.kind === "done") return actResult(outcome.result, operationUsage);
      logger.info("Decisions act fell back to the LLM pipeline", {
        category: "decisions",
        reason: outcome.reason,
      });
      if (!model && !gateway)
        throw new Error(
          "Decisions act needs a configured LLM model or Browserbase gateway for fallback",
        );
    }
    const { combinedTree, combinedXpathMap } = await page.captureSnapshot(
      snapshotOptions,
      progress,
    );

    const actPrompt = buildActPrompt(
      instruction,
      Object.values(SupportedUnderstudyAction),
      variables,
    );

    progress.throwIfStopped();
    const firstInference = await getActionFromLLM({
      instruction: actPrompt,
      domElements: combinedTree,
      xpathMap: combinedXpathMap,
      context,
    });

    if (!firstInference.action) {
      logger.info("No actionable element returned by the LLM", {
        category: "action",
      });
      return actResult(
        {
          success: false,
          message: "Failed to perform act: No action found",
          actionDescription: instruction,
          actions: [],
        },
        operationUsage,
      );
    }

    progress.throwIfStopped();
    const firstResult = await takeDeterministicAction({
      action: firstInference.action,
      variables,
      context,
      expectedElementId: firstInference.expectedElementId,
      expectedDestinationElementId: firstInference.expectedDestinationElementId,
    });

    if (!firstInference.response.twoStep || (decisions && !firstResult.success)) {
      return actResult(firstResult, operationUsage);
    }

    progress.throwIfStopped();
    const { combinedTree: nextTree, combinedXpathMap: nextXpathMap } = await page.captureSnapshot(
      snapshotOptions,
      progress,
    );
    const changedTree = diffCombinedTrees(combinedTree, nextTree);
    const secondInstruction = buildStepTwoPrompt(
      instruction,
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

    progress.throwIfStopped();
    const secondInference = await getActionFromLLM({
      instruction: secondInstruction,
      domElements: changedTree.trim() ? changedTree : nextTree,
      xpathMap: nextXpathMap,
      context,
    });

    if (!secondInference.action) {
      return actResult(firstResult, operationUsage);
    }

    progress.throwIfStopped();
    const secondResult = await takeDeterministicAction({
      action: secondInference.action,
      variables,
      context,
      expectedElementId: secondInference.expectedElementId,
      expectedDestinationElementId: secondInference.expectedDestinationElementId,
    });

    return actResult(
      {
        success: firstResult.success && secondResult.success,
        message: `${firstResult.message} → ${secondResult.message}`,
        actionDescription: firstResult.actionDescription,
        actions: [...firstResult.actions, ...secondResult.actions],
      },
      operationUsage,
    );
  }
}

/**
 * Replays cached actions deterministically — no LLM involved. Any failure
 * throws so the cache intercept falls back to the full inference pipeline,
 * which doubles as the self-heal path for stale cached selectors.
 */
async function replayCachedActions(
  value: unknown,
  instruction: string,
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
      // Only a pre-input rejection on the first action is safe to re-infer.
      if (!context.decisions || (!results.length && !result.actions.length))
        throw new Error(result.message);
      return actResult({
        ...result,
        actions: [...results.flatMap((entry) => entry.actions), ...result.actions],
      });
    }
    results.push(result);
  }

  return actResult({
    success: true,
    message: results.map((result) => result.message).join(" → "),
    actionDescription: instruction,
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
}): Promise<{
  action?: Action;
  expectedElementId?: string;
  expectedDestinationElementId?: string;
  response: ActInferenceResponse;
}> {
  const facts = context.decisions
    ? await context.progress.run("reading fallback action evidence", () =>
        context.page.evaluate(readFacts, xpathMap),
      )
    : undefined;
  const response = await context.progress.run("waiting for act inference", () =>
    inference.act({
      instruction,
      domElements,
      generate: (input) => {
        context.progress.throwIfStopped();
        return llmService.generate(
          context.model,
          input,
          context.clientLLMGenerate,
          context.gateway,
        );
      },
      userProvidedInstructions: context.systemPrompt,
    }),
  );
  context.recordUsage(response);

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
  if (!action || !response.element) return { response };
  // Text-node inference executes on its parent element. Compare the parent's
  // snapshot identity, not the backend ID of the text node it contains.
  const expectedId = (id: string, selector: string): string => {
    const targetPath = selector.slice("xpath=".length);
    return xpathMap[id] === targetPath
      ? id
      : (Object.entries(xpathMap).find(([, path]) => path === targetPath)?.[0] ?? id);
  };
  const expectedElementId = expectedId(response.element.elementId, action.selector);
  const expectedDestinationElementId =
    action.method === SupportedUnderstudyAction.DRAG_AND_DROP &&
    response.element.arguments[0] &&
    action.arguments?.[0]
      ? expectedId(response.element.arguments[0], action.arguments[0])
      : undefined;
  if (facts) {
    const paths = Object.fromEntries(
      [expectedElementId, expectedDestinationElementId]
        .filter((id): id is string => !!id && !!facts[id])
        .map((id) => [id, xpathMap[id]!]),
    );
    if (Object.keys(paths).length) {
      const current = await context.progress.run("revalidating fallback action evidence", () =>
        context.page.evaluate(readFacts, paths),
      );
      if (
        Object.keys(paths).some((id) => JSON.stringify(current[id]) !== JSON.stringify(facts[id]))
      )
        return { response };
    }
  }
  return { action, expectedElementId, expectedDestinationElementId, response };
}

async function takeDeterministicAction({
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
    await performUnderstudyMethod(
      context.page,
      context.page.mainFrame(),
      method,
      action.selector,
      resolvedArgs,
      context.logger,
      context.progress,
      context.domSettleTimeoutMs,
    );
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
    const { combinedTree, combinedXpathMap } = await context.page.captureSnapshot(
      context.decisions ? context.snapshotOptions : {},
      context.progress,
    );
    const inferenceResult = await getActionFromLLM({
      instruction: buildActPrompt(actionInstruction, Object.values(SupportedUnderstudyAction), {}),
      domElements: combinedTree,
      xpathMap: combinedXpathMap,
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
    await performUnderstudyMethod(
      context.page,
      context.page.mainFrame(),
      method,
      selector,
      resolvedArgs,
      context.logger,
      context.progress,
      context.domSettleTimeoutMs,
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
      logger.debug("Drag-and-drop target element lookup failed", {
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

function usageFromInference(response: ActInferenceResponse): StagehandResultUsage {
  return {
    inputTokens: response.prompt_tokens,
    outputTokens: response.completion_tokens,
    reasoningTokens: response.reasoning_tokens,
    cachedInputTokens: response.cached_input_tokens,
    inferenceTimeMs: response.inference_time_ms,
  };
}

function aggregateUsage(
  current: StagehandResultUsage,
  next: StagehandResultUsage,
): StagehandResultUsage {
  return {
    inputTokens: current.inputTokens + next.inputTokens,
    outputTokens: current.outputTokens + next.outputTokens,
    reasoningTokens: current.reasoningTokens + next.reasoningTokens,
    cachedInputTokens: current.cachedInputTokens + next.cachedInputTokens,
    inferenceTimeMs: current.inferenceTimeMs + next.inferenceTimeMs,
  };
}

function actResult(
  result: ActResultData,
  usage: StagehandResultUsage = zeroStagehandResultUsage(),
): ActResult {
  return { data: result, metadata: { usage, cache: disabledCacheMetadata() } };
}

function describeAction(action: Action): string {
  return `method: ${action.method}, description: ${action.description}, arguments: ${action.arguments?.join(", ") ?? ""}`;
}

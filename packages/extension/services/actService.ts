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
import { createTimeoutGuard } from "../handlers/handlerUtils/timeoutGuard.js";
import { resolveVariableValue } from "../handlers/handlerUtils/variables.js";
import * as inference from "../inference.js";
import type { ClientLlmRequest } from "../llm/clientLlmClient.js";
import type { GatewayContext } from "../llm/gatewayClient.js";
import type { StagehandLogger } from "../logger.js";
import { buildActPrompt, buildStepTwoPrompt } from "../prompt.js";
import type { EncodedId } from "../types/private/internal.js";
import { SupportedUnderstudyAction } from "../types/private/handlers.js";
import { diffCombinedTrees } from "../understudy/a11y/snapshot/index.js";
import type { Page } from "../understudy/page.js";
import { trimTrailingTextNode } from "../utils.js";
import * as cacheService from "./cacheService.js";
import { runJevActPipeline, type JevActConfig, type JevActOutcome } from "./jevAct/pipeline.js";
import { redactor } from "./jevAct/args.js";
import { focusOutline, parseOutline } from "./jevAct/tree.js";
import * as llmService from "./llmService.js";
import { disabledCacheMetadata, zeroStagehandResultUsage } from "./resultUsage.js";

// Set high on purpose: on ordinary pages the shortlist cost accuracy (the LLM
// lost the context that disambiguates), so it is reserved for huge trees where
// the full-page call is slow and expensive.
const FOCUS_MIN_TREE_CHARS = 120_000;

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
  ensureTimeRemaining: () => void;
  gateway?: GatewayContext;
  jevAct?: JevActConfig;
  recordUsage: (response: ActInferenceResponse) => void;
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
  gateway,
  jevAct,
  openPageCount,
}: {
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
  jevAct?: JevActConfig;
  openPageCount?: () => number;
}): Promise<ActResult> {
  const { instruction: actInstruction, options } = params;
  const variables = options?.variables;
  const timeout = options?.timeout;
  const ensureTimeRemaining = createTimeoutGuard(timeout, (ms) => new TimeoutError("act()", ms));
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
    ensureTimeRemaining,
    gateway,
    jevAct,
    recordUsage,
  };

  ensureTimeRemaining();
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
  const snapshotOptions = {
    focusLocator: options?.locator,
    ignoreLocators: options?.ignoreLocators,
  };
  await waitForDomNetworkQuiet(page.mainFrame(), logger, domSettleTimeoutMs);
  ensureTimeRemaining();
  let actPath: "llm" | "jev" | "jev+arg-llm" | "jev+llm" = "llm";
  let usedArgumentLlm = false;
  // Jev's shortlist when it narrowed the choice but could not commit.
  let jevFocusIds: string[] = [];
  let jevNoCache = false;
  // Actions Jev already performed before abstaining (e.g. expanding a dropdown).
  let jevPriorActions: ActResultData["actions"] = [];

  return await cacheService.withCache<ActResult>({
    method: "act",
    page,
    data: cacheService.buildActCacheData(params),
    caching: options?.cache,
    bypass: cacheService.shouldBypassCacheForLocatorScope(options),
    context: cache,
    logger,
    onHit: (value) => replayCachedActions(value, instruction, variables, context),
    execute: async () => {
      // performance.now(): tests script Date.now() for inference timing.
      const startedAt = performance.now();
      const result = await runActPipeline();
      // Whatever Jev already did changed the page, whether or not the act
      // then succeeded: it belongs in the result either way.
      if (jevPriorActions.length > 0) {
        result.data.actions = [...jevPriorActions, ...result.data.actions];
      }
      // Experiment instrumentation: one line per act so baseline and Jev arms
      // can be compared on latency and LLM usage from the run log alone. Only
      // with the experimental flag present: the instruction is user content.
      if (jevAct)
        logger.info("Act pipeline finished", {
          category: "jev-eval",
          instruction,
          path: actPath,
          success: result.data.success,
          durationMs: Math.round(performance.now() - startedAt),
          llmInputTokens: result.metadata.usage.inputTokens,
          llmOutputTokens: result.metadata.usage.outputTokens,
          llmMs: result.metadata.usage.inferenceTimeMs,
        });
      // Act can run several inferences (planning, self-heal), so report the
      // aggregate — without it the server has no basis to compute the token
      // savings a future hit avoided.
      const { usage } = result.metadata;
      return {
        result,
        cacheValue:
          result.data.success && result.data.actions.length > 0 && !jevNoCache
            ? result.data.actions
            : undefined,
        llmUsage: {
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          llmDurationMs: usage.inferenceTimeMs,
        },
      };
    },
  });

  async function runActPipeline(): Promise<ActResult> {
    if (jevAct && jevAct.enabled !== false) {
      actPath = "jev";
      const outcome = await runJevActPipeline(jevAct, {
        page,
        logger,
        instruction,
        variables,
        snapshotOptions,
        ensureTimeRemaining,
        openPageCount,
        extractText: async (text) => {
          const response = await inference.actTextArgument({
            instruction: text,
            variableNames: Object.keys(variables ?? {}),
            generate: (input) =>
              llmService.generate(context.model, input, context.clientLLMGenerate, context.gateway),
          });
          // Only the usage fields are read; the act-shaped extras stay empty.
          recordUsage({ ...response, element: null, twoStep: false });
          usedArgumentLlm = true;
          return response.text;
        },
        // Self-heal re-enters LLM inference; a failed Jev action falls back to
        // the full LLM pipeline below instead.
        takeAction: (action) =>
          takeDeterministicAction({ action, variables, context: { ...context, selfHeal: false } }),
      }).catch((error: unknown) => {
        if (error instanceof TimeoutError) throw error;
        const message = error instanceof Error ? error.message : String(error);
        return {
          kind: "fallback",
          reason: `jev_error:${message}`,
        } satisfies JevActOutcome as JevActOutcome;
      });
      if (outcome.kind === "done") {
        jevNoCache = outcome.noCache === true;
        if (usedArgumentLlm) actPath = "jev+arg-llm";
        return actResult(outcome.result, operationUsage);
      }
      actPath = "jev+llm";
      jevPriorActions = outcome.priorActions ?? [];
      if (outcome.noCache) jevNoCache = true;
      jevFocusIds = jevAct.focusFallback ? (outcome.focusIds ?? []) : [];
      logger.info("Jev act fell back to the LLM pipeline", {
        category: "jev",
        instruction,
        reason: outcome.reason,
      });
      if (jevAct.llmFallback === false) {
        actPath = "jev";
        return actResult(
          {
            success: false,
            // Reasons can carry error text; redact typed values and keep it short.
            message: `Failed to perform act: Jev abstained (${(redactor(variables) ?? ((text: string) => text))(outcome.reason).slice(0, 160)})`,
            actionDescription: instruction,
            actions: [],
          },
          operationUsage,
        );
      }
    }

    const { combinedTree, combinedXpathMap } = await page.captureSnapshot(snapshotOptions);

    const actPrompt = buildActPrompt(
      instruction,
      Object.values(SupportedUnderstudyAction),
      variables,
    );

    // Jev shortlisted a handful of elements on a big page: show the LLM those
    // (with ancestors and subtrees) first, and only pay for the whole tree if
    // it finds nothing there.
    let firstInference: Awaited<ReturnType<typeof getActionFromLLM>> | undefined;
    if (jevFocusIds.length > 0 && combinedTree.length > FOCUS_MIN_TREE_CHARS) {
      const focused = focusOutline(parseOutline(combinedTree), jevFocusIds);
      if (focused.trim() && focused.length < combinedTree.length / 2) {
        ensureTimeRemaining();
        const attempt = await getActionFromLLM({
          instruction: actPrompt,
          domElements: focused,
          xpathMap: combinedXpathMap,
          context,
        });
        logger.info("Jev focused LLM fallback", {
          category: "jev",
          instruction,
          focusIds: jevFocusIds.length,
          focusedChars: focused.length,
          fullChars: combinedTree.length,
          found: Boolean(attempt.action),
        });
        if (attempt.action) firstInference = attempt;
      }
    }

    ensureTimeRemaining();
    firstInference ??= await getActionFromLLM({
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

    ensureTimeRemaining();
    const firstResult = await takeDeterministicAction({
      action: firstInference.action,
      variables,
      context,
    });

    if (!firstInference.response.twoStep) {
      return actResult(firstResult, operationUsage);
    }

    ensureTimeRemaining();
    const { combinedTree: nextTree, combinedXpathMap: nextXpathMap } =
      await page.captureSnapshot(snapshotOptions);
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

    ensureTimeRemaining();
    const secondInference = await getActionFromLLM({
      instruction: secondInstruction,
      domElements: changedTree.trim() ? changedTree : nextTree,
      xpathMap: nextXpathMap,
      context,
    });

    if (!secondInference.action) {
      return actResult(firstResult, operationUsage);
    }

    ensureTimeRemaining();
    const secondResult = await takeDeterministicAction({
      action: secondInference.action,
      variables,
      context,
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
      throw new Error(result.message);
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
}): Promise<{ action?: Action; response: ActInferenceResponse }> {
  const response = await inference.act({
    instruction,
    domElements,
    generate: (input) =>
      llmService.generate(context.model, input, context.clientLLMGenerate, context.gateway),
    userProvidedInstructions: context.systemPrompt,
  });
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

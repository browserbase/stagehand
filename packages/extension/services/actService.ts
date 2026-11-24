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
import { waitForDomNetworkQuiet } from "../handlers/handlerUtils/actHandlerUtils.js";
import type { ClientLlmRequest } from "../llm/clientLlmClient.js";
import type { GatewayContext } from "../llm/gatewayClient.js";
import type { StagehandLogger } from "../logger.js";
import { buildActPrompt, buildStepTwoPrompt } from "../prompt.js";
import { SupportedUnderstudyAction } from "../types/private/handlers.js";
import { diffCombinedTrees } from "../understudy/a11y/snapshot/index.js";
import type { Page } from "../understudy/page.js";
import { type Progress, runWithProgress } from "../understudy/progress.js";
import { takeDeterministicAction, type ActContext } from "./act/execution.js";
import { getActionFromLLM, type ActInferenceResponse } from "./act/inference.js";
import * as cacheService from "./cacheService.js";
import { requestsMenuOpening } from "./decisions/clickOwner.js";
import { runDecisionsAct } from "./decisions/act.js";
import type { DecisionsConfig } from "./decisions/config.js";
import { withDecisionUsage } from "./decisions/usage.js";
import { substituteVariables } from "./decisions/args.js";
import { disabledCacheMetadata, zeroStagehandResultUsage } from "./resultUsage.js";

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
    snapshotOptions: decisions ? { ...snapshotOptions, singleLineNames: true } : snapshotOptions,
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
  let noCache = false;
  // Match only a complete instruction. A qualifier or conditional can still require an action.
  if (
    decisions &&
    !systemPrompt &&
    /^(?:please\s+)?(?:do nothing|take no action|leave the page (?:alone|unchanged)|(?:do not|don['’]t) click anything)[.!]?$/iu.test(
      instruction.trim(),
    )
  ) {
    return noActionResult(instruction, operationUsage);
  }
  await waitForDomNetworkQuiet(page, logger, domSettleTimeoutMs, progress);
  progress.throwIfStopped();

  return await cacheService.withCache<ActResult>({
    method: "act",
    page,
    data: cacheService.buildActCacheData(params),
    caching: options?.cache,
    // A cached action sequence does not carry the menu identity for readback.
    bypass:
      cacheService.shouldBypassCacheForLocatorScope(options) ||
      Boolean(decisions && requestsMenuOpening(substituteVariables(instruction, variables))),
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
      return {
        result,
        cacheValue:
          !noCache && result.data.success && result.data.actions.length > 0
            ? result.data.actions
            : undefined,
        llmUsage: {
          inputTokens: llmUsage.inputTokens,
          outputTokens: llmUsage.outputTokens,
          llmDurationMs: llmUsage.inferenceTimeMs,
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
      if (outcome.kind === "done") {
        noCache = outcome.noCache === true;
        return actResult(outcome.result, operationUsage);
      }
      logger.info("Decisions act fell back to the LLM pipeline", {
        category: "decisions",
        reason: outcome.reason,
      });
      if (!model && !gateway)
        throw new Error(
          "Decisions act needs a configured LLM model or Browserbase gateway for fallback",
        );
    }
    const snapshot = await page.captureSnapshot(context.snapshotOptions, progress);

    const actPrompt = buildActPrompt(
      instruction,
      Object.values(SupportedUnderstudyAction),
      variables,
    );

    progress.throwIfStopped();
    const firstInference = await getActionFromLLM({
      instruction: actPrompt,
      domElements: snapshot.combinedTree,
      snapshot,
      context,
    });

    if (!firstInference.action) {
      logger.info("No actionable element returned by the LLM", {
        category: "action",
      });
      return noActionResult(instruction, operationUsage);
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
    const nextSnapshot = await page.captureSnapshot(context.snapshotOptions, progress);
    const changedTree = diffCombinedTrees(snapshot.combinedTree, nextSnapshot.combinedTree);
    const secondInstruction = buildStepTwoPrompt(
      instruction,
      decisions && firstInference.response.element
        ? `${describeAction(firstInference.action)}; executed at [${firstInference.response.element.elementId}] (${firstInference.action.selector})`
        : describeAction(firstInference.action),
      Object.values(SupportedUnderstudyAction).filter(
        (
          action,
        ): action is Exclude<
          SupportedUnderstudyAction,
          SupportedUnderstudyAction.SELECT_OPTION_FROM_DROPDOWN
        > => action !== SupportedUnderstudyAction.SELECT_OPTION_FROM_DROPDOWN,
      ),
      variables,
      Boolean(decisions),
    );

    progress.throwIfStopped();
    const secondInference = await getActionFromLLM({
      instruction: secondInstruction,
      domElements: changedTree.trim() ? changedTree : nextSnapshot.combinedTree,
      snapshot: nextSnapshot,
      checkPreviousAction: Boolean(decisions),
      context,
    });

    if (!secondInference.action) {
      if (
        decisions &&
        (secondInference.response.element ||
          !secondInference.response.previousActionCompletedRequest)
      ) {
        return actResult(
          {
            ...firstResult,
            success: false,
            message: "The first action ran, but the second step had no matching target.",
            actionDescription: instruction,
          },
          operationUsage,
        );
      }
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

function noActionResult(instruction: string, usage: StagehandResultUsage): ActResult {
  return actResult(
    {
      success: false,
      message: "Failed to perform act: No action found",
      actionDescription: instruction,
      actions: [],
    },
    usage,
  );
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

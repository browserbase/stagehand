import type {
  ActResult,
  ActResultData,
  ClientModelReference,
  ModelConfig,
  StagehandActParams,
  StagehandResultUsage,
} from "@browserbasehq/stagehand-protocol/types";
import { TimeoutError } from "../errors.js";
import { waitForDomNetworkQuiet } from "../handlers/handlerUtils/actHandlerUtils.js";
import { createTimeoutGuard } from "../handlers/handlerUtils/timeoutGuard.js";
import type { ClientLlmRequest } from "../llm/clientLlmClient.js";
import type { GatewayContext } from "../llm/gatewayClient.js";
import type { StagehandLogger } from "../logger.js";
import type { Page } from "../understudy/page.js";
import * as cacheService from "./cacheService.js";
import { createActionRunner } from "./drivers/actionRunner.js";
import { llmActDriver } from "./drivers/llm/index.js";
import { createLlmPort } from "./drivers/llmPort.js";
import type { ActDriver, ActRequest, CachedActionGuard } from "./drivers/types.js";
import { disabledCacheMetadata, zeroStagehandResultUsage } from "./resultUsage.js";

/**
 * act(): perform what the instruction describes.
 *
 * This service owns the call's frame — timeout, DOM settle, cache lookup and replay, usage,
 * the result envelope — and asks `driver` for the one thing in the middle: which action to
 * take. The driver defaults to the language model; see `drivers/` for the contract.
 */
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
  openPageCount,
  driver = llmActDriver(),
  cachedActionGuard,
  logTiming = false,
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
  openPageCount?: () => number;
  /** Chooses the action for a natural-language instruction. */
  driver?: ActDriver;
  /** Vets each cached action before it is replayed. */
  cachedActionGuard?: CachedActionGuard;
  /** Log one line per act with its path, duration and LLM usage. */
  logTiming?: boolean;
}): Promise<ActResult> {
  const { instruction: actInstruction, options } = params;
  const variables = options?.variables;
  const ensureTimeRemaining = createTimeoutGuard(
    options?.timeout,
    (ms) => new TimeoutError("act()", ms),
  );
  const { llm, usage } = createLlmPort({ model, clientLLMGenerate, gateway, systemPrompt });
  const runAction = createActionRunner({
    page,
    logger,
    llm,
    variables,
    selfHeal,
    domSettleTimeoutMs,
    ensureTimeRemaining,
  });

  ensureTimeRemaining();
  // An Action is already a decision: perform it.
  if (typeof actInstruction !== "string") {
    return actResult(await runAction(actInstruction), usage());
  }

  const instruction = actInstruction;
  // performance.now(): tests script Date.now() for inference timing.
  const startedAt = performance.now();
  const settled = waitForDomNetworkQuiet(page.mainFrame(), logger, domSettleTimeoutMs);
  const request: ActRequest = {
    instruction,
    variables,
    page,
    snapshotOptions: {
      focusLocator: options?.locator,
      ignoreLocators: options?.ignoreLocators,
    },
    settled,
    ensureTimeRemaining,
    logger,
    llm,
    runAction,
    openPageCount,
  };
  driver.prepare?.(request);

  // The cache lookup keys on the page's tree and URL, so when a cache is in play the page must
  // have settled before it; only cache-less acts let the driver start early.
  const cacheLookup = cache !== undefined && options?.cache !== false;
  if (driver.startsBeforeSettle && !cacheLookup) settled.catch(() => {});
  else await settled;
  ensureTimeRemaining();

  return await cacheService.withCache<ActResult>({
    method: "act",
    page,
    data: cacheService.buildActCacheData(params),
    caching: options?.cache,
    bypass: cacheService.shouldBypassCacheForLocatorScope(options),
    context: cache,
    logger,
    onHit: async (value) => {
      await settled;
      return await replayCachedActions(value, request, cachedActionGuard);
    },
    execute: async () => {
      const resolveStartedAt = performance.now();
      const resolution = await driver.resolve(request);
      if (resolution.kind === "abstained") {
        // A lone driver that abstains has nothing behind it; chains and `actOrFail` never
        // reach here. Treat it as the failure it is.
        throw new Error(`act() failed: no driver resolved the instruction (${resolution.reason})`);
      }
      const result = actResult(resolution.result, usage());
      if (logTiming) {
        // One line per act, so runs can be compared on latency and LLM usage from the log.
        logger.info("Act pipeline finished", {
          category: "act-timing",
          instruction,
          path: resolution.path,
          success: result.data.success,
          durationMs: Math.round(performance.now() - resolveStartedAt),
          // From the start of act(), DOM settle included: what the caller waits for.
          totalMs: Math.round(performance.now() - startedAt),
          llmInputTokens: result.metadata.usage.inputTokens,
          llmOutputTokens: result.metadata.usage.outputTokens,
          llmMs: result.metadata.usage.inferenceTimeMs,
        });
      }
      // Act can run several inferences (planning, self-heal), so report the aggregate — without
      // it the server has no basis to compute the token savings a future hit avoided.
      const spent = result.metadata.usage;
      return {
        result,
        cacheValue:
          result.data.success && result.data.actions.length > 0 && resolution.cacheable
            ? result.data.actions
            : undefined,
        llmUsage: {
          inputTokens: spent.inputTokens,
          outputTokens: spent.outputTokens,
          llmDurationMs: spent.inferenceTimeMs,
        },
      };
    },
  });
}

/**
 * Replays cached actions deterministically — no driver involved. Any failure throws so the
 * cache intercept falls back to full resolution, which doubles as the self-heal path for stale
 * cached selectors.
 */
async function replayCachedActions(
  value: unknown,
  request: ActRequest,
  guard: CachedActionGuard | undefined,
): Promise<ActResult> {
  const actions = cacheService.normalizeCachedActions(value);
  if (actions.length === 0) {
    throw new Error("Cached act value contained no usable actions");
  }

  const results: ActResultData[] = [];
  for (const action of actions) {
    if (guard) {
      const check = await guard.check(action, request);
      if (check.verdict === "stale") {
        throw new Error(`Cached action no longer matches the page: ${check.detail}`);
      }
    }
    const result = await request.runAction(action, { selfHeal: false });
    if (!result.success) {
      throw new Error(result.message);
    }
    results.push(result);
  }

  return actResult({
    success: true,
    message: results.map((result) => result.message).join(" → "),
    actionDescription: request.instruction,
    actions: results.flatMap((result) => result.actions),
  });
}

function actResult(
  result: ActResultData,
  usage: StagehandResultUsage = zeroStagehandResultUsage(),
): ActResult {
  return { data: result, metadata: { usage, cache: disabledCacheMetadata() } };
}

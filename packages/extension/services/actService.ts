import type {
  ActResult,
  ActResultData,
  ClientModelReference,
  ModelConfig,
  StagehandActParams,
  StagehandResultUsage,
} from "@browserbasehq/stagehand-protocol/types";
import { waitForDomNetworkQuiet } from "../handlers/handlerUtils/actHandlerUtils.js";
import type { ClientLlmRequest } from "../llm/clientLlmClient.js";
import type { GatewayContext } from "../llm/gatewayClient.js";
import type { StagehandLogger } from "../logger.js";
import type { Page } from "../understudy/page.js";
import { type Progress, runWithProgress } from "../understudy/progress.js";
import * as cacheService from "./cacheService.js";
import { createActionRunner } from "./drivers/actionRunner.js";
import { llmActDriver } from "./drivers/llm/index.js";
import { createLlmPort } from "./drivers/llmPort.js";
import type { ActDriver, ActRequest, CachedActionGuard } from "./drivers/types.js";
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
  openPageCount?: () => number;
  driver?: ActDriver;
  cachedActionGuard?: CachedActionGuard;
  logTiming?: boolean;
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
    openPageCount,
    driver = llmActDriver(),
    cachedActionGuard,
    logTiming = false,
  }: ActServiceOptions,
  progress: Progress,
): Promise<ActResult> {
  const { instruction: actInstruction, options } = params;
  const variables = options?.variables;
  const ensureTimeRemaining = () => progress.throwIfStopped();
  const { llm, usage } = createLlmPort({
    model,
    clientLLMGenerate,
    gateway,
    systemPrompt,
    progress,
    operation: "act",
  });
  const runAction = createActionRunner({
    page,
    logger,
    llm,
    variables,
    selfHeal,
    domSettleTimeoutMs,
    progress,
  });

  progress.throwIfStopped();
  if (typeof actInstruction !== "string") {
    return actResult(await runAction(actInstruction), usage());
  }

  const instruction = actInstruction;
  const startedAt = performance.now();
  const settled = waitForDomNetworkQuiet(page.mainFrame(), logger, domSettleTimeoutMs, progress);
  const request: ActRequest = {
    instruction,
    variables,
    page,
    snapshotOptions: {
      focusLocator: options?.locator,
      ignoreLocators: options?.ignoreLocators,
    },
    settled,
    progress,
    ensureTimeRemaining,
    logger,
    llm,
    runAction,
    openPageCount,
  };
  driver.prepare?.(request);

  const cacheBypass = cacheService.shouldBypassCacheForLocatorScope(options);
  const cacheLookup =
    cache !== undefined &&
    !cacheBypass &&
    (options?.cache ?? cache.defaultCaching ?? true) !== false;
  if (driver.startsBeforeSettle && !cacheLookup) settled.catch(() => {});
  else await settled;
  progress.throwIfStopped();

  return await cacheService.withCache<ActResult>({
    method: "act",
    page,
    data: cacheService.buildActCacheData(params),
    caching: options?.cache,
    bypass: cacheBypass,
    context: cache,
    logger,
    progress,
    onHit: async (value) => {
      await settled;
      return await replayCachedActions(value, request, cachedActionGuard);
    },
    execute: async () => {
      const resolveStartedAt = performance.now();
      const resolution = await driver.resolve(request);
      if (resolution.kind === "abstained") {
        throw new Error(`act() failed: no driver resolved the instruction (${resolution.reason})`);
      }
      const result = actResult(resolution.result, usage());
      if (logTiming) {
        logger.info("Act pipeline finished", {
          category: "act-timing",
          instruction,
          path: resolution.path,
          success: result.data.success,
          durationMs: Math.round(performance.now() - resolveStartedAt),
          totalMs: Math.round(performance.now() - startedAt),
          llmInputTokens: result.metadata.usage.inputTokens,
          llmOutputTokens: result.metadata.usage.outputTokens,
          llmMs: result.metadata.usage.inferenceTimeMs,
        });
      }
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

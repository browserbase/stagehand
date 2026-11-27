import type {
  ClientModelReference,
  ModelConfig,
  ObserveResult,
  StagehandObserveParams,
} from "@browserbasehq/stagehand-protocol/types";
import type { ClientLlmRequest } from "../llm/clientLlmClient.js";
import type { GatewayContext } from "../llm/gatewayClient.js";
import type { StagehandLogger } from "../logger.js";
import type { Page } from "../understudy/page.js";
import { type Progress, runWithProgress } from "../understudy/progress.js";
import * as cacheService from "./cacheService.js";
import { llmObserveDriver } from "./drivers/llm/index.js";
import { createLlmPort } from "./drivers/llmPort.js";
import type { ObserveDriver } from "./drivers/types.js";
import { disabledCacheMetadata, zeroStagehandResultUsage } from "./resultUsage.js";

type ObserveServiceOptions = {
  params: StagehandObserveParams;
  page: Pick<Page, "captureSnapshot">;
  model: ModelConfig | ClientModelReference | undefined;
  clientLLMGenerate: ClientLlmRequest;
  logger: StagehandLogger;
  systemPrompt?: string;
  cache?: cacheService.CacheContext;
  gateway?: GatewayContext;
  driver?: ObserveDriver;
  progress?: Progress;
};

export async function observe(options: ObserveServiceOptions): Promise<ObserveResult> {
  return runWithProgress(
    options.progress ?? { name: "observe()", timeout: options.params.options?.timeout ?? 0 },
    (progress) => observeWithProgress(options, progress),
  );
}

async function observeWithProgress(
  {
    params,
    page,
    model,
    clientLLMGenerate,
    logger,
    systemPrompt = "",
    cache,
    gateway,
    driver = llmObserveDriver(),
  }: ObserveServiceOptions,
  progress: Progress,
): Promise<ObserveResult> {
  const { instruction, options } = params;
  logger.info("Starting observation", {
    category: "observation",
    ...(instruction === undefined ? {} : { instruction }),
  });

  return await cacheService.withCache<ObserveResult>({
    method: "observe",
    page,
    data: cacheService.buildObserveCacheData(params),
    caching: options?.cache,
    bypass: cacheService.shouldBypassCacheForLocatorScope(options),
    context: cache,
    logger,
    progress,
    onHit: (value) => {
      const actions = cacheService.normalizeCachedActions(value);
      if (actions.length === 0) {
        throw new Error("Cached observe value contained no usable actions");
      }
      return {
        data: actions,
        metadata: { usage: zeroStagehandResultUsage(), cache: disabledCacheMetadata() },
      };
    },
    execute: async () => {
      const { llm, usage } = createLlmPort({
        model,
        clientLLMGenerate,
        gateway,
        systemPrompt,
        progress,
        operation: "observe",
      });
      const resolution = await driver.resolve({
        instruction,
        variables: options?.variables,
        page,
        snapshotOptions: {
          focusLocator: options?.locator,
          ignoreLocators: options?.ignoreLocators,
        },
        progress,
        ensureTimeRemaining: () => progress.throwIfStopped(),
        logger,
        llm,
      });
      if (resolution.kind === "abstained") {
        throw new Error(
          `observe() failed: no driver resolved the instruction (${resolution.reason})`,
        );
      }
      const spent = usage();
      return {
        result: {
          data: resolution.actions,
          metadata: { usage: spent, cache: disabledCacheMetadata() },
        },
        cacheValue: resolution.actions.length > 0 ? resolution.actions : undefined,
        llmUsage: {
          inputTokens: spent.inputTokens,
          outputTokens: spent.outputTokens,
          llmDurationMs: spent.inferenceTimeMs,
        },
      };
    },
  });
}

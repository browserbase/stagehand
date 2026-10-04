import type {
  ClientModelReference,
  ModelConfig,
  ObserveResult,
  StagehandObserveParams,
} from "@browserbasehq/stagehand-protocol/types";
import { TimeoutError } from "../errors.js";
import { createTimeoutGuard } from "../handlers/handlerUtils/timeoutGuard.js";
import type { ClientLlmRequest } from "../llm/clientLlmClient.js";
import type { GatewayContext } from "../llm/gatewayClient.js";
import type { StagehandLogger } from "../logger.js";
import type { Page } from "../understudy/page.js";
import * as cacheService from "./cacheService.js";
import { llmObserveDriver } from "./drivers/llm/index.js";
import { createLlmPort } from "./drivers/llmPort.js";
import type { ObserveDriver } from "./drivers/types.js";
import { disabledCacheMetadata, zeroStagehandResultUsage } from "./resultUsage.js";

/**
 * observe(): list the actions on the page that match the instruction.
 *
 * This service owns the timeout, the cache and the result envelope, and asks `driver` which
 * elements match. The driver defaults to the language model; see `drivers/` for the contract.
 */
export async function observe({
  params,
  page,
  model,
  clientLLMGenerate,
  logger,
  systemPrompt = "",
  cache,
  gateway,
  driver = llmObserveDriver(),
}: {
  params: StagehandObserveParams;
  page: Pick<Page, "captureSnapshot">;
  model: ModelConfig | ClientModelReference | undefined;
  clientLLMGenerate: ClientLlmRequest;
  logger: StagehandLogger;
  systemPrompt?: string;
  cache?: cacheService.CacheContext;
  gateway?: GatewayContext;
  /** Finds the matching elements. */
  driver?: ObserveDriver;
}): Promise<ObserveResult> {
  const { instruction, options } = params;
  const ensureTimeRemaining = createTimeoutGuard(
    options?.timeout,
    (ms) => new TimeoutError("observe()", ms),
  );
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
      const { llm, usage } = createLlmPort({ model, clientLLMGenerate, gateway, systemPrompt });
      const resolution = await driver.resolve({
        instruction,
        variables: options?.variables,
        page,
        snapshotOptions: {
          focusLocator: options?.locator,
          ignoreLocators: options?.ignoreLocators,
        },
        ensureTimeRemaining,
        logger,
        llm,
      });
      if (resolution.kind === "abstained") {
        // A lone driver that abstains has nothing behind it; chains and `observeOrFail` never
        // reach here.
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

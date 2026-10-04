import type {
  ClientModelReference,
  ExtractResult,
  ModelConfig,
  StagehandExtractParams,
} from "@browserbasehq/stagehand-protocol/types";
import { z } from "zod/v4";
import { TimeoutError } from "../errors.js";
import { createTimeoutGuard } from "../handlers/handlerUtils/timeoutGuard.js";
import type { ClientLlmRequest } from "../llm/clientLlmClient.js";
import type { GatewayContext } from "../llm/gatewayClient.js";
import type { StagehandLogger } from "../logger.js";
import type { Page } from "../understudy/page.js";
import * as cacheService from "./cacheService.js";
import { llmExtractDriver } from "./drivers/llm/index.js";
import { createLlmPort } from "./drivers/llmPort.js";
import type { ExtractDriver } from "./drivers/types.js";
import { disabledCacheMetadata, zeroStagehandResultUsage } from "./resultUsage.js";

export { transformUrlStringsToNumericIds } from "./drivers/llm/extract.js";

/**
 * extract(): read structured data off the page.
 *
 * This service owns the timeout, the page capture, the cache and the result envelope, and asks
 * `driver` for the values. The driver defaults to the language model; see `drivers/` for the
 * contract.
 */
export async function extract({
  params,
  page,
  model,
  clientLLMGenerate,
  logger,
  systemPrompt = "",
  cache,
  gateway,
  driver = llmExtractDriver(),
}: {
  params: StagehandExtractParams;
  page: Pick<Page, "captureSnapshot" | "screenshot">;
  model: ModelConfig | ClientModelReference | undefined;
  clientLLMGenerate: ClientLlmRequest;
  logger: StagehandLogger;
  systemPrompt?: string;
  cache?: cacheService.CacheContext;
  gateway?: GatewayContext;
  /** Produces the values for the schema. */
  driver?: ExtractDriver;
}): Promise<ExtractResult> {
  const { instruction, options } = params;
  const ensureTimeRemaining = createTimeoutGuard(
    options?.timeout,
    (ms) => new TimeoutError("extract()", ms),
  );

  // Cache keys contain DOM state, not screenshot pixels. Do not serve a
  // visual extraction from a cache entry that cannot represent its image.
  if (options?.screenshot) {
    return (await runExtraction()).result;
  }

  return await cacheService.withCache<ExtractResult>({
    method: "extract",
    page,
    data: cacheService.buildExtractCacheData(params),
    caching: options?.cache,
    bypass: cacheService.shouldBypassCacheForLocatorScope(options),
    context: cache,
    logger,
    onHit: (value) => ({
      data: z.json().parse(value),
      metadata: { usage: zeroStagehandResultUsage(), cache: disabledCacheMetadata() },
    }),
    execute: () => runExtraction(),
  });

  async function runExtraction(): Promise<cacheService.CacheExecuteOutcome<ExtractResult>> {
    ensureTimeRemaining();
    const { combinedTree, combinedUrlMap } = await page.captureSnapshot({
      focusLocator: options?.locator,
      ignoreLocators: options?.ignoreLocators,
    });
    ensureTimeRemaining();

    let screenshot: Uint8Array | undefined;
    if (options?.screenshot) {
      screenshot = await page.screenshot({ fullPage: false, type: "png" });
      ensureTimeRemaining();
    }

    logger.info(
      screenshot
        ? "Starting extraction using an accessibility snapshot and viewport screenshot"
        : "Starting extraction using an accessibility snapshot",
      { category: "extraction", instruction },
    );

    const { llm, usage } = createLlmPort({ model, clientLLMGenerate, gateway, systemPrompt });
    const resolution = await driver.resolve({
      instruction,
      jsonSchema: params.schema,
      schema: z.fromJSONSchema(params.schema as Parameters<typeof z.fromJSONSchema>[0]),
      snapshot: {
        tree: combinedTree,
        urlMap: (combinedUrlMap ?? {}) as Record<string, string>,
      },
      ...(screenshot ? { screenshot } : {}),
      ensureTimeRemaining,
      logger,
      llm,
    });
    if (resolution.kind === "abstained") {
      // A lone driver that abstains has nothing behind it; chains and `extractOrFail` never
      // reach here.
      throw new Error(
        `extract() failed: no driver resolved the instruction (${resolution.reason})`,
      );
    }

    const spent = usage();
    return {
      result: {
        data: z.json().parse(resolution.data),
        metadata: { usage: spent, cache: disabledCacheMetadata() },
      },
      cacheValue: resolution.data,
      llmUsage: {
        inputTokens: spent.inputTokens,
        outputTokens: spent.outputTokens,
        llmDurationMs: spent.inferenceTimeMs,
      },
    };
  }
}

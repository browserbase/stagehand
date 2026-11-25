import type {
  ClientModelReference,
  ExtractResult,
  ModelConfig,
  StagehandExtractParams,
} from "@browserbasehq/stagehand-protocol/types";
import { z } from "zod/v4";
import type { ClientLlmRequest } from "../llm/clientLlmClient.js";
import type { GatewayContext } from "../llm/gatewayClient.js";
import type { StagehandLogger } from "../logger.js";
import type { Page } from "../understudy/page.js";
import { type Progress, runWithProgress } from "../understudy/progress.js";
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
type ExtractServiceOptions = {
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
  /** The caller's deadline; extract() starts its own from `options.timeout` when absent. */
  progress?: Progress;
};

export async function extract(options: ExtractServiceOptions): Promise<ExtractResult> {
  return runWithProgress(
    options.progress ?? { name: "extract()", timeout: options.params.options?.timeout ?? 0 },
    (progress) => extractWithProgress(options, progress),
  );
}

async function extractWithProgress(
  {
    params,
    page,
    model,
    clientLLMGenerate,
    logger,
    systemPrompt = "",
    cache,
    gateway,
    driver = llmExtractDriver(),
  }: ExtractServiceOptions,
  progress: Progress,
): Promise<ExtractResult> {
  const { instruction, options } = params;
  const ensureTimeRemaining = () => progress.throwIfStopped();

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
    progress,
    onHit: (value) => ({
      data: z.json().parse(value),
      metadata: { usage: zeroStagehandResultUsage(), cache: disabledCacheMetadata() },
    }),
    execute: () => runExtraction(),
  });

  async function runExtraction(): Promise<cacheService.CacheExecuteOutcome<ExtractResult>> {
    ensureTimeRemaining();
    const { combinedTree, combinedUrlMap } = await page.captureSnapshot(
      {
        focusLocator: options?.locator,
        ignoreLocators: options?.ignoreLocators,
      },
      progress,
    );
    ensureTimeRemaining();

    const screenshot = options?.screenshot
      ? await page.screenshot({ fullPage: false, type: "png" }, progress)
      : undefined;
    ensureTimeRemaining();

    logger.info(
      screenshot
        ? "Starting extraction using an accessibility snapshot and viewport screenshot"
        : "Starting extraction using an accessibility snapshot",
      { category: "extraction", instruction },
    );

    const { llm, usage } = createLlmPort({
      model,
      clientLLMGenerate,
      gateway,
      systemPrompt,
      progress,
      operation: "extract",
    });
    const resolution = await driver.resolve({
      instruction,
      jsonSchema: params.schema,
      schema: z.fromJSONSchema(params.schema as Parameters<typeof z.fromJSONSchema>[0]),
      snapshot: {
        tree: combinedTree,
        urlMap: (combinedUrlMap ?? {}) as Record<string, string>,
      },
      ...(screenshot ? { screenshot } : {}),
      progress,
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

import { z } from "zod/v4";
import { isJsonObject, validateDynamicJsonSchema } from "../../protocol/dynamic-json-schema.js";
import type {
  ClientModelReference,
  ExtractResult,
  LLMImageContent,
  ModelConfig,
  StagehandExtractParams,
} from "../../protocol/types.js";
import { TimeoutError } from "../errors.js";
import * as inference from "../inference.js";
import type { ClientLlmRequest } from "../llm/clientLlmClient.js";
import type { GatewayContext } from "../llm/gatewayClient.js";
import {
  createStructuredOutputContractFromValidated,
  StructuredOutputValidationError,
} from "../llm/structuredOutput.js";
import type { StagehandLogger } from "../logger.js";
import { bytesToBase64 } from "../understudy/fileUploadUtils.js";
import type { Page } from "../understudy/page.js";
import type { EncodedId } from "../types/private/internal.js";
import { createTimeoutGuard } from "../handlers/handlerUtils/timeoutGuard.js";
import * as cacheService from "./cacheService.js";
import {
  createUrlAwareExtractionSchema,
  schemaRequiresObject,
  wrapRootSchema,
} from "./extractSchemaUrls.js";
import * as llmService from "./llmService.js";
import { disabledCacheMetadata, zeroStagehandResultUsage } from "./resultUsage.js";

interface ExtractionResponse extends Record<string, unknown> {
  metadata: { completed: boolean };
  prompt_tokens: number;
  completion_tokens: number;
  reasoning_tokens: number;
  cached_input_tokens: number;
  inference_time_ms: number;
}

export async function extract({
  params,
  page,
  model,
  clientLLMGenerate,
  logger,
  systemPrompt = "",
  cache,
  gateway,
}: {
  params: StagehandExtractParams;
  page: Pick<Page, "captureSnapshot" | "screenshot">;
  model: ModelConfig | ClientModelReference | undefined;
  clientLLMGenerate: ClientLlmRequest;
  logger: StagehandLogger;
  systemPrompt?: string;
  cache?: cacheService.CacheContext;
  gateway?: GatewayContext;
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

    const screenshot = options?.screenshot
      ? await (async () => {
          ensureTimeRemaining();
          const image = await page.screenshot({ fullPage: false, type: "png" });
          ensureTimeRemaining();
          return image;
        })()
      : undefined;

    logger.info(
      screenshot
        ? "Starting extraction using an accessibility snapshot and viewport screenshot"
        : "Starting extraction using an accessibility snapshot",
      { category: "extraction", instruction },
    );

    const schema = validateDynamicJsonSchema(params.schema);
    const isObjectSchema = schemaRequiresObject(schema);
    const wrapKey = "value" as const;
    const wrappedSchema = isObjectSchema ? schema : wrapRootSchema(schema, wrapKey);
    const urlAwareSchema = createUrlAwareExtractionSchema(wrappedSchema);
    const transformedSchema = createStructuredOutputContractFromValidated(
      "Extraction",
      urlAwareSchema.jsonSchema,
    );
    const screenshotContent: LLMImageContent | undefined = screenshot
      ? { type: "image", data: bytesToBase64(screenshot), mimeType: "image/png" }
      : undefined;

    ensureTimeRemaining();
    const extractionResponse = (await inference.extract({
      instruction,
      domElements: combinedTree,
      schema: transformedSchema,
      generate: (input) => llmService.generate(model, input, clientLLMGenerate, gateway),
      userProvidedInstructions: systemPrompt,
      screenshot: screenshotContent,
    })) as ExtractionResponse;
    ensureTimeRemaining();

    const {
      metadata: { completed },
      prompt_tokens,
      completion_tokens,
      reasoning_tokens,
      cached_input_tokens,
      inference_time_ms,
      ...rest
    } = extractionResponse;
    let output: unknown = rest;
    const idToUrl = (combinedUrlMap ?? {}) as Record<EncodedId, string>;
    output = urlAwareSchema.restoreUrls(output, idToUrl);
    const restored = createStructuredOutputContractFromValidated(
      "Extraction",
      wrappedSchema,
    ).validate(output);
    if (restored.issues) throw new StructuredOutputValidationError(restored.issues);
    output = restored.value;
    if (!isObjectSchema && isJsonObject(output)) output = output[wrapKey];

    logger.info(
      completed
        ? "Extraction completed successfully"
        : "Extraction incomplete after processing all data",
      {
        category: "extraction",
        promptTokens: prompt_tokens,
        completionTokens: completion_tokens,
        inferenceTimeMs: inference_time_ms,
      },
    );

    const data = z.json().parse(output);
    return {
      result: {
        data,
        metadata: {
          usage: {
            inputTokens: prompt_tokens,
            outputTokens: completion_tokens,
            reasoningTokens: reasoning_tokens,
            cachedInputTokens: cached_input_tokens,
            inferenceTimeMs: inference_time_ms,
          },
          cache: disabledCacheMetadata(),
        },
      },
      cacheValue: data,
      llmUsage: {
        inputTokens: prompt_tokens,
        outputTokens: completion_tokens,
        llmDurationMs: inference_time_ms,
      },
    };
  }
}

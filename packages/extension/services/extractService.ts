import { runDecisionsExtract } from "./decisions/extract.js";
import type { DecisionsConfig } from "./decisions/config.js";
import { withDecisionUsage } from "./decisions/usage.js";
import { z } from "zod/v4";
import type {
  ClientModelReference,
  ExtractResult,
  LLMImageContent,
  ModelConfig,
  StagehandExtractParams,
} from "@browserbasehq/stagehand-protocol/types";
import * as inference from "../inference.js";
import type { ClientLlmRequest } from "../llm/clientLlmClient.js";
import type { GatewayContext } from "../llm/gatewayClient.js";
import type { StagehandLogger } from "../logger.js";
import { bytesToBase64 } from "../understudy/fileUploadUtils.js";
import type { Page } from "../understudy/page.js";
import { type Progress, runWithProgress } from "../understudy/progress.js";
import type { EncodedId, ZodPathSegments } from "../types/private/internal.js";
import { injectUrls, transformSchema } from "../utils.js";
import * as cacheService from "./cacheService.js";
import * as llmService from "./llmService.js";
import { disabledCacheMetadata, zeroStagehandResultUsage } from "./resultUsage.js";

/** Replaces URL strings with numeric DOM IDs until extraction has resolved the page's URL map. */
export function transformUrlStringsToNumericIds<Schema extends z.ZodType>(
  schema: Schema,
): [z.ZodType, ZodPathSegments[]] {
  const [finalSchema, urlPaths] = transformSchema(schema, []);
  return [finalSchema, urlPaths];
}

type ExtractServiceOptions = {
  params: StagehandExtractParams;
  page: Pick<Page, "captureSnapshot" | "screenshot">;
  model: ModelConfig | ClientModelReference | undefined;
  clientLLMGenerate: ClientLlmRequest;
  logger: StagehandLogger;
  systemPrompt?: string;
  cache?: cacheService.CacheContext;
  gateway?: GatewayContext;
  decisions?: DecisionsConfig;
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
    decisions,
  }: ExtractServiceOptions,
  progress: Progress,
): Promise<ExtractResult> {
  const { instruction, options } = params;
  decisions = withDecisionUsage(decisions, progress.signal, logger);

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
    progress,
    onHit: (value) => ({
      data: z.json().parse(value),
      metadata: { usage: zeroStagehandResultUsage(), cache: disabledCacheMetadata() },
    }),
    execute: () => runExtraction(),
  });

  async function runExtraction(): Promise<cacheService.CacheExecuteOutcome<ExtractResult>> {
    progress.throwIfStopped();
    const snapshot = await page.captureSnapshot(
      {
        focusLocator: options?.locator,
        ignoreLocators: options?.ignoreLocators,
      },
      progress,
    );
    progress.throwIfStopped();

    const { combinedTree, combinedUrlMap } = snapshot;
    let decisionUsage = zeroStagehandResultUsage();
    const screenshot = options?.screenshot
      ? await page.screenshot({ fullPage: false, type: "png" }, progress)
      : undefined;
    progress.throwIfStopped();

    logger.info("Starting extraction", {
      category: "extraction",
      instruction,
    });

    const schema = z.fromJSONSchema(params.schema as Parameters<typeof z.fromJSONSchema>[0]);
    // Custom policy can require transformations the evidence mapper cannot represent.
    if (decisions && instruction && !screenshot && !systemPrompt) {
      const outcome = await runDecisionsExtract(decisions, {
        instruction,
        schema: params.schema,
        snapshot,
        progress,
        logger,
      });
      decisionUsage = outcome.usage;
      if (outcome.kind === "done")
        return {
          result: {
            data: outcome.data,
            metadata: { usage: decisionUsage, cache: disabledCacheMetadata() },
          },
          cacheValue: outcome.data,
          llmUsage: { inputTokens: 0, outputTokens: 0, llmDurationMs: 0 },
        };
    }
    if (decisions && !model && !gateway)
      throw new Error(
        "Decisions extract needs a configured LLM model or Browserbase gateway for fallback",
      );
    const isObjectSchema = schema instanceof z.ZodObject;
    const wrapKey = "value" as const;
    const objectSchema: z.ZodObject = isObjectSchema
      ? schema
      : z.object({
          [wrapKey]: schema,
        });
    const [transformedSchema, urlFieldPaths] = transformUrlStringsToNumericIds(objectSchema);
    const screenshotContent: LLMImageContent | undefined = screenshot
      ? {
          type: "image",
          data: bytesToBase64(screenshot),
          mimeType: "image/png",
        }
      : undefined;

    progress.throwIfStopped();
    const { data, usage, durationMs } = await inference.extract({
      instruction,
      domElements: combinedTree,
      schema: transformedSchema as z.ZodObject,
      generate: (input) =>
        progress.run("waiting for extract inference", () =>
          llmService.generate(model, input, clientLLMGenerate, gateway),
        ),
      userProvidedInstructions:
        decisions !== undefined
          ? [
              systemPrompt,
              "For optional fields, omit the field when the supplied page does not contain the requested fact. Absence is not zero. Return zero only when the page explicitly reports zero for that fact. Do not infer values from outside knowledge.",
            ]
              .filter(Boolean)
              .join("\n")
          : systemPrompt,
      screenshot: screenshotContent,
    });
    progress.throwIfStopped();

    const {
      inputTokens = 0,
      outputTokens = 0,
      reasoningTokens = 0,
      cachedInputTokens = 0,
    } = usage ?? {};
    let output: unknown = data;

    const idToUrl: Record<EncodedId, string> = (combinedUrlMap ?? {}) as Record<EncodedId, string>;
    for (const { segments } of urlFieldPaths) {
      injectUrls(
        output as Record<string, unknown>,
        segments,
        idToUrl as unknown as Record<string, string>,
      );
    }
    if (!isObjectSchema && output && typeof output === "object") {
      output = (output as Record<string, unknown>)[wrapKey] as z.infer<z.ZodObject>;
    }

    logger.info("Extraction result returned", {
      category: "extraction",
      promptTokens: inputTokens,
      completionTokens: outputTokens,
      inferenceTimeMs: durationMs,
    });

    return {
      result: {
        data: z.json().parse(output),
        metadata: {
          usage: {
            inputTokens: inputTokens + decisionUsage.inputTokens,
            outputTokens: outputTokens + decisionUsage.outputTokens,
            reasoningTokens,
            cachedInputTokens,
            inferenceTimeMs: durationMs + decisionUsage.inferenceTimeMs,
          },
          cache: disabledCacheMetadata(),
        },
      },
      cacheValue: output,
      llmUsage: {
        inputTokens,
        outputTokens,
        llmDurationMs: durationMs,
      },
    };
  }
}

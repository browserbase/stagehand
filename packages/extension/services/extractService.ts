import { extractionCompleted } from "./jevAct/extractCheck.js";
import { runJevExtract, type JsonSchema } from "./jevAct/extract.js";
import type { JevActConfig } from "./jevAct/pipeline.js";
import { parseOutline } from "./jevAct/tree.js";
import { z } from "zod/v4";
import type {
  ClientModelReference,
  ExtractResult,
  LLMImageContent,
  ModelConfig,
  StagehandExtractParams,
} from "@browserbasehq/stagehand-protocol/types";
import { TimeoutError } from "../errors.js";
import * as inference from "../inference.js";
import type { ClientLlmRequest } from "../llm/clientLlmClient.js";
import type { GatewayContext } from "../llm/gatewayClient.js";
import type { StagehandLogger } from "../logger.js";
import { bytesToBase64 } from "../understudy/fileUploadUtils.js";
import type { Page } from "../understudy/page.js";
import type { EncodedId, ZodPathSegments } from "../types/private/internal.js";
import { injectUrls, transformSchema } from "../utils.js";
import { createTimeoutGuard } from "../handlers/handlerUtils/timeoutGuard.js";
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

interface ExtractionResponseBase {
  metadata: { completed: boolean };
  prompt_tokens: number;
  completion_tokens: number;
  reasoning_tokens: number;
  cached_input_tokens: number;
  inference_time_ms: number;
}

type ExtractionResponse<Schema extends z.ZodObject> = ExtractionResponseBase & z.infer<Schema>;

export async function extract({
  params,
  page,
  model,
  clientLLMGenerate,
  logger,
  systemPrompt = "",
  cache,
  gateway,
  jev,
}: {
  params: StagehandExtractParams;
  page: Pick<Page, "captureSnapshot" | "screenshot">;
  model: ModelConfig | ClientModelReference | undefined;
  clientLLMGenerate: ClientLlmRequest;
  logger: StagehandLogger;
  systemPrompt?: string;
  cache?: cacheService.CacheContext;
  gateway?: GatewayContext;
  /** Experimental: Jev judges completion ("judge") or picks the values itself ("pick"). */
  jev?: JevActConfig;
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
          const image = await page.screenshot({
            fullPage: false,
            type: "png",
          });
          ensureTimeRemaining();
          return image;
        })()
      : undefined;

    logger.info(
      screenshot
        ? "Starting extraction using an accessibility snapshot and viewport screenshot"
        : "Starting extraction using an accessibility snapshot",
      {
        category: "extraction",
        instruction,
      },
    );

    const schema = z.fromJSONSchema(params.schema as Parameters<typeof z.fromJSONSchema>[0]);

    // Pick-and-copy: Jev chooses the elements that hold the values, code copies
    // their text. Screenshot-based extraction stays with the LLM.
    if (jev?.extract === "pick" && instruction && !screenshot) {
      const outcome = await runJevExtract(jev, {
        logger,
        instruction,
        schema: params.schema as JsonSchema,
        snap: { tree: combinedTree, xpathMap: {}, nodes: parseOutline(combinedTree) },
        urlMap: (combinedUrlMap ?? {}) as Record<string, string>,
        ensureTimeRemaining,
        gate: jev.llmFallback !== false,
      }).catch((error: unknown) => {
        if (error instanceof TimeoutError) throw error;
        const message = error instanceof Error ? error.message : String(error);
        return { kind: "fallback" as const, reason: `jev_error:${message}` };
      });
      const valid = outcome.kind === "done" ? schema.safeParse(outcome.data) : undefined;
      if (outcome.kind === "done" && valid?.success) {
        return {
          result: {
            data: z.json().parse(valid.data),
            metadata: { usage: zeroStagehandResultUsage(), cache: disabledCacheMetadata() },
          },
          cacheValue: valid.data,
          llmUsage: { inputTokens: 0, outputTokens: 0, llmDurationMs: 0 },
        };
      }
      const reason = outcome.kind === "fallback" ? outcome.reason : "schema_mismatch";
      logger.info("Jev extract fell back to the LLM", { category: "jev", instruction, reason });
      if (jev.llmFallback === false) {
        throw new Error(`Jev extract abstained (${reason})`);
      }
    }
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

    ensureTimeRemaining();
    const extractionResponse: ExtractionResponse<z.ZodObject> =
      await inference.extract<z.ZodObject>({
        instruction,
        domElements: combinedTree,
        schema: transformedSchema as z.ZodObject,
        generate: (input) => llmService.generate(model, input, clientLLMGenerate, gateway),
        userProvidedInstructions: systemPrompt,
        screenshot: screenshotContent,
        ...(jev && instruction
          ? {
              judgeCompleted: async (extracted: unknown) => {
                const trace: Record<string, unknown>[] = [];
                const verdict = await extractionCompleted(
                  {
                    config: jev,
                    instruction,
                    trace: trace as never,
                    threshold: 0.5,
                    logger,
                    ensureTimeRemaining,
                  },
                  extracted,
                );
                logger.info("Jev extract completion", {
                  category: "jev",
                  instruction,
                  score: verdict.score,
                  trace: JSON.stringify(trace),
                });
                return verdict.completed;
              },
            }
          : {}),
      });
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
    let output = rest as z.infer<z.ZodObject>;

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

    return {
      result: {
        data: z.json().parse(output),
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
      cacheValue: output,
      llmUsage: {
        inputTokens: prompt_tokens,
        outputTokens: completion_tokens,
        llmDurationMs: inference_time_ms,
      },
    };
  }
}

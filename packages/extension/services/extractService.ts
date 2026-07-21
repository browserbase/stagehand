import { z } from "zod/v4";
import type {
  ClientModelReference,
  ExtractResult,
  ModelConfig,
  StagehandExtractParams,
} from "../../protocol/types.js";
import { TimeoutError } from "../errors.js";
import * as inference from "../inference.js";
import type { ClientLlmRequest } from "../llm/clientLlmClient.js";
import type { StagehandLogger } from "../logger.js";
import type { Page } from "../understudy/page.js";
import type { EncodedId, ZodPathSegments } from "../types/private/internal.js";
import { injectUrls, transformSchema } from "../utils.js";
import { createTimeoutGuard } from "../handlers/handlerUtils/timeoutGuard.js";
import * as llmService from "./llmService.js";

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
  cached_input_tokens?: number;
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
}: {
  params: StagehandExtractParams;
  page: Pick<Page, "captureSnapshot">;
  model: ModelConfig | ClientModelReference;
  clientLLMGenerate: ClientLlmRequest;
  logger: StagehandLogger;
  systemPrompt?: string;
}): Promise<ExtractResult> {
  const { instruction, options } = params;
  const ensureTimeRemaining = createTimeoutGuard(
    options?.timeout,
    (ms) => new TimeoutError("extract()", ms),
  );

  if (options?.screenshot) {
    // TODO: Add image content to the shared LLM protocol before enabling screenshot extraction.
    throw new TypeError("extract({ screenshot: true }) is not implemented yet.");
  }

  const focusSelector = options?.selector?.replace(/^xpath=/i, "") ?? "";
  ensureTimeRemaining();
  const { combinedTree, combinedUrlMap } = await page.captureSnapshot({
    focusSelector: focusSelector || undefined,
    ignoreSelectors: options?.ignoreSelectors,
  });
  ensureTimeRemaining();

  logger.info("Starting extraction using an accessibility snapshot", {
    category: "extraction",
    instruction,
  });

  const schema = z.fromJSONSchema(params.schema as Parameters<typeof z.fromJSONSchema>[0]);
  const isObjectSchema = schema instanceof z.ZodObject;
  const wrapKey = "value" as const;
  const objectSchema: z.ZodObject = isObjectSchema
    ? schema
    : z.object({
        [wrapKey]: schema,
      });
  const [transformedSchema, urlFieldPaths] = transformUrlStringsToNumericIds(objectSchema);

  ensureTimeRemaining();
  const extractionResponse: ExtractionResponse<z.ZodObject> = await inference.extract<z.ZodObject>({
    instruction,
    domElements: combinedTree,
    schema: transformedSchema as z.ZodObject,
    generate: (input) => llmService.generate(model, input, clientLLMGenerate),
    userProvidedInstructions: systemPrompt,
  });
  ensureTimeRemaining();

  const {
    metadata: { completed },
    prompt_tokens,
    completion_tokens,
    reasoning_tokens: _reasoningTokens,
    cached_input_tokens: _cachedInputTokens,
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

  const resultString = JSON.stringify(output) ?? "undefined";
  const resultPreview =
    resultString.length > 200 ? resultString.slice(0, 200) + "..." : resultString;

  logger.info(
    completed
      ? "Extraction completed successfully"
      : "Extraction incomplete after processing all data",
    {
      category: "extraction",
      promptTokens: prompt_tokens,
      completionTokens: completion_tokens,
      inferenceTimeMs: inference_time_ms,
      result: resultPreview,
    },
  );

  return { result: output };
}

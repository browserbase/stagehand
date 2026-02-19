// lib/v3/handlers/extractHandler.ts
import { extract as runExtract } from "../../inference.js";
import {
  getZFactory,
  getZodType,
  injectUrls,
  transformSchema,
} from "../../utils.js";
import { v3Logger } from "../logger.js";
import { V3FunctionName } from "../types/public/methods.js";
import { captureHybridSnapshot } from "../understudy/a11y/snapshot/index.js";
import type { ZodTypeAny } from "zod";
import { LLMClient } from "../llm/LLMClient.js";
import { ExtractHandlerParams } from "../types/private/handlers.js";
import { EncodedId, ZodPathSegments } from "../types/private/internal.js";
import {
  defaultExtractSchema,
  pageTextSchema,
} from "../types/public/methods.js";
import {
  AvailableModel,
  ClientOptions,
  ModelConfiguration,
} from "../types/public/model.js";
import {
  StagehandInvalidArgumentError,
  ExtractTimeoutError,
} from "../types/public/sdkErrors.js";
import { createTimeoutGuard } from "./handlerUtils/timeoutGuard.js";
import type {
  InferStagehandSchema,
  StagehandZodObject,
  StagehandZodSchema,
} from "../zodCompat.js";

/**
 * Scans the provided Zod schema for any `z.string().url()` fields and
 * replaces them with `z.number()`.
 *
 * @param schema - The Zod object schema to transform.
 * @returns A tuple containing:
 *   1. The transformed schema (or the original schema if no changes were needed).
 *   2. An array of {@link ZodPathSegments} objects representing all the replaced URL fields,
 *      with each path segment showing where in the schema the replacement occurred.
 */
export function transformUrlStringsToNumericIds<T extends StagehandZodSchema>(
  schema: T,
): [StagehandZodSchema, ZodPathSegments[]] {
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

type ExtractionResponse<T extends StagehandZodObject> = ExtractionResponseBase &
  InferStagehandSchema<T>;

export class ExtractHandler {
  private readonly llmClient: LLMClient;
  private readonly defaultModelName: AvailableModel;
  private readonly defaultClientOptions: ClientOptions;
  private readonly resolveLlmClient: (model?: ModelConfiguration) => LLMClient;
  private readonly systemPrompt: string;
  private readonly logInferenceToFile: boolean;
  private readonly experimental: boolean;
  private readonly onMetrics?: (
    functionName: V3FunctionName,
    promptTokens: number,
    completionTokens: number,
    reasoningTokens: number,
    cachedInputTokens: number,
    inferenceTimeMs: number,
  ) => void;

  constructor(
    llmClient: LLMClient,
    defaultModelName: AvailableModel,
    defaultClientOptions: ClientOptions,
    resolveLlmClient: (model?: ModelConfiguration) => LLMClient,
    systemPrompt?: string,
    logInferenceToFile?: boolean,
    experimental?: boolean,
    onMetrics?: (
      functionName: V3FunctionName,
      promptTokens: number,
      completionTokens: number,
      reasoningTokens: number,
      cachedInputTokens: number,
      inferenceTimeMs: number,
    ) => void,
  ) {
    this.llmClient = llmClient;
    this.defaultModelName = defaultModelName;
    this.defaultClientOptions = defaultClientOptions;
    this.resolveLlmClient = resolveLlmClient;
    this.systemPrompt = systemPrompt ?? "";
    this.logInferenceToFile = logInferenceToFile ?? false;
    this.experimental = experimental ?? false;
    this.onMetrics = onMetrics;
  }

  async extract<T extends StagehandZodSchema>(
    params: ExtractHandlerParams<T>,
  ): Promise<InferStagehandSchema<T> | { pageText: string }> {
    const { instruction, schema, page, selector, timeout, model } = params;

    const llmClient = this.resolveLlmClient(model);

    const effectiveTimeoutMs =
      typeof timeout === "number" && timeout > 0 ? timeout : undefined;
    const ensureTimeRemaining = createTimeoutGuard(
      effectiveTimeoutMs,
      (ms) => new ExtractTimeoutError(ms),
    );

    // No-args → page text (parity with v2)
    const noArgs = !instruction && !schema;
    if (noArgs) {
      const focusSelector = selector?.replace(/^xpath=/i, "") ?? "";
      ensureTimeRemaining();
      const snap = await captureHybridSnapshot(page, {
        experimental: this.experimental,
        focusSelector: focusSelector || undefined,
      });

      const result = { pageText: snap.combinedTree };
      // Validate via the same schema used in v2
      return pageTextSchema.parse(result);
    }

    if (!instruction && schema) {
      throw new StagehandInvalidArgumentError(
        "extract() requires an instruction when a schema is provided.",
      );
    }

    const focusSelector = selector?.replace(/^xpath=/, "") ?? "";

    // Build the hybrid snapshot (includes combinedTree; combinedUrlMap optional)
    ensureTimeRemaining();
    const { combinedTree, combinedUrlMap } = await captureHybridSnapshot(page, {
      experimental: this.experimental,
      focusSelector: focusSelector,
    });

    v3Logger({
      category: "extraction",
      message: "Starting extraction using a11y snapshot",
      level: 1,
      auxiliary: instruction
        ? { instruction: { value: instruction, type: "string" } }
        : undefined,
    });

    // Normalize schema: if instruction provided without schema, use defaultExtractSchema
    const baseSchema: StagehandZodSchema = (schema ??
      defaultExtractSchema) as StagehandZodSchema;
    // Ensure we pass an object schema into inference; wrap non-object schemas
    const isObjectSchema = getZodType(baseSchema) === "object";
    const WRAP_KEY = "value" as const;
    const factory = getZFactory(baseSchema);
    const objectSchema: StagehandZodObject = isObjectSchema
      ? (baseSchema as StagehandZodObject)
      : (factory.object({
          [WRAP_KEY]: baseSchema as ZodTypeAny,
        }) as StagehandZodObject);

    const [transformedSchema, urlFieldPaths] =
      transformUrlStringsToNumericIds(objectSchema);

    ensureTimeRemaining();
    const extractionResponse: ExtractionResponse<StagehandZodObject> =
      await runExtract<StagehandZodObject>({
        instruction,
        domElements: combinedTree,
        schema: transformedSchema as StagehandZodObject,
        llmClient,
        userProvidedInstructions: this.systemPrompt,
        logger: v3Logger,
        logInferenceToFile: this.logInferenceToFile,
      });

    const {
      metadata: { completed },
      prompt_tokens,
      completion_tokens,
      reasoning_tokens = 0,
      cached_input_tokens = 0,
      inference_time_ms,
      ...rest
    } = extractionResponse;
    let output = rest as InferStagehandSchema<StagehandZodObject>;

    // Update EXTRACT metrics from the LLM calls
    this.onMetrics?.(
      V3FunctionName.EXTRACT,
      prompt_tokens,
      completion_tokens,
      reasoning_tokens,
      cached_input_tokens,
      inference_time_ms,
    );

    // Re-inject URLs for any url() fields we temporarily converted to number()
    const idToUrl: Record<EncodedId, string> = (combinedUrlMap ?? {}) as Record<
      EncodedId,
      string
    >;
    for (const { segments } of urlFieldPaths) {
      injectUrls(
        output as Record<string, unknown>,
        segments,
        idToUrl as unknown as Record<string, string>,
      );
    }
    // If we wrapped a non-object schema, unwrap the value
    if (!isObjectSchema && output && typeof output === "object") {
      output = (output as Record<string, unknown>)[WRAP_KEY];
    }

    const resultPreviewLength = 200;
    const resultString = JSON.stringify(output) ?? "undefined";
    const resultPreview =
      resultString.length > resultPreviewLength
        ? resultString.slice(0, resultPreviewLength) + "..."
        : resultString;

    v3Logger({
      category: "extraction",
      message: completed
        ? "Extraction completed successfully"
        : "Extraction incomplete after processing all data",
      level: 1,
      auxiliary: {
        prompt_tokens: { value: String(prompt_tokens), type: "string" },
        completion_tokens: { value: String(completion_tokens), type: "string" },
        inference_time_ms: {
          value: String(inference_time_ms),
          type: "string",
        },
        result: { value: resultPreview, type: "string" },
      },
    });

    return output as InferStagehandSchema<T>;
  }
}

// lib/v3/handlers/extractHandler.ts
import { z } from "zod/v4";
import { extract as runExtract } from "../inference.js";
import { getZodType, injectUrls, transformSchema } from "../utils.js";
import { v3Logger } from "../logger.js";
import { V3FunctionName } from "../types/public/methods.js";
import { captureHybridSnapshot } from "../understudy/a11y/snapshot/index.js";
import { LLMClient } from "../llm/LLMClient.js";
import { ExtractHandlerParams } from "../types/private/handlers.js";
import { EncodedId, ZodPathSegments } from "../types/private/internal.js";
import { defaultExtractSchema, pageTextSchema } from "../types/public/methods.js";
import { AvailableModel, ClientOptions, ModelConfiguration } from "../types/public/model.js";
import { StagehandInvalidArgumentError, ExtractTimeoutError } from "../types/public/sdkErrors.js";
import { createTimeoutGuard } from "./handlerUtils/timeoutGuard.js";

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
export function transformUrlStringsToNumericIds<T extends z.ZodType>(
  schema: T,
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

type ExtractionResponse<T extends z.ZodObject> = ExtractionResponseBase & z.infer<T>;

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

  async extract<T extends z.ZodType>(
    params: ExtractHandlerParams<T>,
  ): Promise<z.infer<T> | { pageText: string }> {
    const { instruction, schema, page, selector, ignoreSelectors, timeout, model, screenshot } =
      params;

    const llmClient = this.resolveLlmClient(model);

    const ensureTimeRemaining = createTimeoutGuard(timeout, (ms) => new ExtractTimeoutError(ms));

    // No-args → page text (parity with v2)
    const noArgs = !instruction && !schema;
    if (noArgs) {
      const focusSelector = selector?.replace(/^xpath=/i, "") ?? "";
      ensureTimeRemaining();
      const snap = await captureHybridSnapshot(page, {
        experimental: this.experimental,
        focusSelector: focusSelector || undefined,
        ignoreSelectors,
      });
      ensureTimeRemaining();

      const result = { pageText: snap.combinedTree };
      // Validate via the same schema used in v2
      return pageTextSchema.parse(result);
    }

    if (!instruction && schema) {
      throw new StagehandInvalidArgumentError(
        "extract() requires an instruction when a schema is provided.",
      );
    }

    if (screenshot && llmClient.type !== "aisdk") {
      throw new StagehandInvalidArgumentError(
        "extract({ screenshot: true }) is only supported with AI SDK clients.",
      );
    }

    const focusSelector = selector?.replace(/^xpath=/, "") ?? "";

    // Build the hybrid snapshot (includes combinedTree; combinedUrlMap optional)
    ensureTimeRemaining();
    const { combinedTree, combinedUrlMap } = await captureHybridSnapshot(page, {
      experimental: this.experimental,
      focusSelector: focusSelector,
      ignoreSelectors,
    });

    const screenshotBuffer = screenshot
      ? await (async () => {
          ensureTimeRemaining();
          const buffer = await page.screenshot({
            fullPage: false,
            type: "png",
          });
          ensureTimeRemaining();
          return buffer;
        })()
      : undefined;

    v3Logger({
      category: "extraction",
      message: screenshot
        ? "Starting extraction using a11y snapshot and viewport screenshot"
        : "Starting extraction using a11y snapshot",
      level: 1,
      auxiliary: instruction ? { instruction: { value: instruction, type: "string" } } : undefined,
    });

    // Normalize schema: if instruction provided without schema, use defaultExtractSchema
    const baseSchema: z.ZodType = (schema ?? defaultExtractSchema) as z.ZodType;
    // Ensure we pass an object schema into inference; wrap non-object schemas
    const isObjectSchema = getZodType(baseSchema) === "object";
    const WRAP_KEY = "value" as const;
    const objectSchema: z.ZodObject = isObjectSchema
      ? (baseSchema as z.ZodObject)
      : z.object({
          [WRAP_KEY]: baseSchema,
        });

    const [transformedSchema, urlFieldPaths] = transformUrlStringsToNumericIds(objectSchema);

    ensureTimeRemaining();
    if (!instruction) {
      throw new StagehandInvalidArgumentError("extract() requires an instruction.");
    }

    const extractionResponse: ExtractionResponse<z.ZodObject> = await runExtract<z.ZodObject>({
      instruction,
      domElements: combinedTree,
      schema: transformedSchema as z.ZodObject,
      llmClient,
      userProvidedInstructions: this.systemPrompt,
      logger: v3Logger,
      logInferenceToFile: this.logInferenceToFile,
      screenshot: screenshotBuffer,
    });

    const {
      metadata: { completed },
      prompt_tokens,
      completion_tokens,
      reasoning_tokens,
      cached_input_tokens = 0,
      inference_time_ms,
      ...rest
    } = extractionResponse;
    let output = rest as z.infer<z.ZodObject>;

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
    const idToUrl: Record<EncodedId, string> = (combinedUrlMap ?? {}) as Record<EncodedId, string>;
    for (const { segments } of urlFieldPaths) {
      injectUrls(
        output as Record<string, unknown>,
        segments,
        idToUrl as unknown as Record<string, string>,
      );
    }
    // If we wrapped a non-object schema, unwrap the value
    if (!isObjectSchema && output && typeof output === "object") {
      output = (output as Record<string, unknown>)[WRAP_KEY] as z.infer<z.ZodObject>;
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

    return output as z.infer<T>;
  }
}

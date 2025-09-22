// lib/v3/handlers/extractHandler.ts
import { z, ZodTypeAny } from "zod/v3";
import { ExtractHandlerParams, V3FunctionName } from "@/lib/v3/types";
import { LLMClient } from "../llm/LLMClient";
import { AvailableModel, ClientOptions } from "../types/model";
import { captureHybridSnapshot } from "@/lib/v3/understudy/a11y/snapshot";
import { extract as runExtract } from "@/lib/inference";
import { pageTextSchema } from "../types";
import { injectUrls, transformSchema } from "@/lib/utils";
import { EncodedId } from "../types/context";
import { ZodPathSegments } from "../types/stagehand";
import { v3Logger } from "@/lib/v3/logger";

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
export function transformUrlStringsToNumericIds<
  T extends z.ZodObject<z.ZodRawShape>,
>(schema: T): [T, ZodPathSegments[]] {
  const shape = schema._def.shape();
  const newShape: Record<string, ZodTypeAny> = {};
  const urlPaths: ZodPathSegments[] = [];
  let changed = false;

  for (const [key, value] of Object.entries(shape)) {
    const [childTransformed, childPaths] = transformSchema(value, [key]);
    newShape[key] = childTransformed;
    if (childTransformed !== value) {
      changed = true;
    }
    if (childPaths.length > 0) {
      childPaths.forEach((cp) => {
        urlPaths.push({ segments: [key, ...cp.segments] });
      });
    }
  }

  const finalSchema = changed ? z.object(newShape) : schema;
  return [finalSchema as T, urlPaths];
}

interface ExtractionResponseBase {
  metadata: { completed: boolean };
  prompt_tokens: number;
  completion_tokens: number;
  inference_time_ms: number;
}

type ExtractionResponse<T extends z.AnyZodObject> = ExtractionResponseBase &
  z.infer<T>;

export class ExtractHandler {
  private readonly llmClient: LLMClient;
  private readonly defaultModelName: AvailableModel;
  private readonly defaultClientOptions: ClientOptions;
  private readonly systemPrompt: string;
  private readonly logInferenceToFile: boolean;
  private readonly experimental: boolean;
  private readonly onMetrics?: (
    functionName: V3FunctionName,
    promptTokens: number,
    completionTokens: number,
    inferenceTimeMs: number,
  ) => void;

  constructor(
    llmClient: LLMClient,
    defaultModelName: AvailableModel,
    defaultClientOptions: ClientOptions,
    systemPrompt?: string,
    logInferenceToFile?: boolean,
    experimental?: boolean,
    onMetrics?: (
      functionName: V3FunctionName,
      promptTokens: number,
      completionTokens: number,
      inferenceTimeMs: number,
    ) => void,
  ) {
    this.llmClient = llmClient;
    this.defaultModelName = defaultModelName;
    this.defaultClientOptions = defaultClientOptions;
    this.systemPrompt = systemPrompt ?? "";
    this.logInferenceToFile = logInferenceToFile ?? false;
    this.experimental = experimental ?? false;
    this.onMetrics = onMetrics;
  }

  async extract<T extends z.AnyZodObject>(
    params: ExtractHandlerParams<T>,
  ): Promise<z.infer<T> | { page_text: string }> {
    const { instruction, schema, page, selector } = params;

    // No-args → page text (parity with v2)
    const noArgs = !instruction && !schema;
    if (noArgs) {
      const focusSelector = selector?.replace(/^xpath=/i, "") ?? "";
      const snap = await captureHybridSnapshot(page, {
        experimental: this.experimental,
        focusSelector: focusSelector || undefined,
      });

      const result = { page_text: snap.combinedTree };
      // Validate via the same schema used in v2
      return pageTextSchema.parse(result);
    }

    const focusSelector = selector?.replace(/^xpath=/, "") ?? "";

    // Build the hybrid snapshot (includes combinedTree; combinedUrlMap optional)
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

    if (!schema || !instruction) {
      throw new Error(
        "extract() requires both `instruction` and `schema` in V3.",
      );
    }

    const [transformedSchema, urlFieldPaths] =
      transformUrlStringsToNumericIds(schema);

    const requestId =
      (globalThis.crypto as Crypto | undefined)?.randomUUID?.() ??
      `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;

    const extractionResponse = (await runExtract({
      instruction,
      domElements: combinedTree,
      schema: transformedSchema,
      chunksSeen: 1,
      chunksTotal: 1,
      llmClient: this.llmClient,
      requestId,
      userProvidedInstructions: this.systemPrompt,
      logger: v3Logger,
      logInferenceToFile: this.logInferenceToFile,
    })) as ExtractionResponse<T>;

    const {
      metadata: { completed },
      prompt_tokens,
      completion_tokens,
      inference_time_ms,
      ...output
    } = extractionResponse;

    v3Logger({
      category: "extraction",
      message: completed
        ? "Extraction completed successfully"
        : "Extraction incomplete after processing all data",
      level: 1,
      auxiliary: {
        prompt_tokens: { value: String(prompt_tokens), type: "string" },
        completion_tokens: { value: String(completion_tokens), type: "string" },
        inference_time_ms: { value: String(inference_time_ms), type: "string" },
      },
    });

    // Update EXTRACT metrics from the LLM calls
    this.onMetrics?.(
      V3FunctionName.EXTRACT,
      prompt_tokens,
      completion_tokens,
      inference_time_ms,
    );

    // Re-inject URLs for any url() fields we temporarily converted to number()
    const idToUrl: Record<EncodedId, string> = (combinedUrlMap ?? {}) as Record<
      EncodedId,
      string
    >;
    for (const { segments } of urlFieldPaths) {
      injectUrls(
        output as unknown as Record<string, unknown>,
        segments,
        idToUrl,
      );
    }

    return output as z.infer<T>;
  }
}

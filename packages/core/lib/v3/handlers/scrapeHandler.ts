// lib/v3/handlers/scrapeHandler.ts
import { scrape as runScrape } from "../../inference";
import { getZFactory, getZodType, coerceSchemaToElementIds } from "../../utils";
import { v3Logger } from "../logger";
import { V3FunctionName } from "../types/public/methods";
import { captureHybridSnapshot } from "../understudy/a11y/snapshot";
import type { ZodTypeAny } from "zod";
import { LLMClient } from "../llm/LLMClient";
import { ScrapeHandlerParams } from "../types/private/handlers";
import {
  defaultScrapeSchema,
  pageTextSchema,
  ScrapeResult,
  ScrapeElementId,
  SCRAPE_SCHEMA_FIELD,
} from "../types/public/methods";
import {
  AvailableModel,
  ClientOptions,
  ModelConfiguration,
} from "../types/public/model";
import {
  StagehandInvalidArgumentError,
  ScrapeTimeoutError,
} from "../types/public/sdkErrors";
import { createTimeoutGuard } from "./handlerUtils/timeoutGuard";
import type {
  InferStagehandSchema,
  StagehandZodObject,
  StagehandZodSchema,
} from "../zodCompat";

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
interface ScrapeResponseBase {
  metadata: { completed: boolean };
  prompt_tokens: number;
  completion_tokens: number;
  reasoning_tokens: number;
  cached_input_tokens?: number;
  inference_time_ms: number;
}

type ScrapeResponse<T extends StagehandZodObject> = ScrapeResponseBase &
  InferStagehandSchema<T>;

export class ScrapeHandler {
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

  async scrape<T extends StagehandZodSchema>(
    params: ScrapeHandlerParams<T>,
  ): Promise<ScrapeResult<T> | { pageText: string }> {
    const { instruction, schema, page, selector, timeout, model } = params;

    const llmClient = this.resolveLlmClient(model);

    const effectiveTimeoutMs =
      typeof timeout === "number" && timeout > 0 ? timeout : undefined;
    const ensureTimeRemaining = createTimeoutGuard(
      effectiveTimeoutMs,
      (ms) => new ScrapeTimeoutError(ms),
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
        "scrape() requires an instruction when a schema is provided.",
      );
    }

    const focusSelector = selector?.replace(/^xpath=/, "") ?? "";

    // Build the hybrid snapshot (includes combinedTree and xpath map for ID lookup)
    ensureTimeRemaining();
    const { combinedTree, combinedXpathMap } = await captureHybridSnapshot(
      page,
      {
        experimental: this.experimental,
        focusSelector: focusSelector,
      },
    );

    v3Logger({
      category: "scrape",
      message: "Starting scrape using a11y snapshot",
      level: 1,
      auxiliary: instruction
        ? { instruction: { value: instruction, type: "string" } }
        : undefined,
    });

    const effectiveSchema =
      instruction && !schema ? defaultScrapeSchema : schema;

    // Normalize schema: if instruction provided without schema, use defaultScrapeSchema
    const baseSchema: StagehandZodSchema = (effectiveSchema ??
      defaultScrapeSchema) as StagehandZodSchema;
    // Ensure we pass an object schema into inference; wrap non-object schemas
    const isObjectSchema = getZodType(baseSchema) === "object";
    const WRAP_KEY = "value" as const;
    const factory = getZFactory(baseSchema);
    const objectSchema: StagehandZodObject = isObjectSchema
      ? (baseSchema as StagehandZodObject)
      : (factory.object({
          [WRAP_KEY]: baseSchema as ZodTypeAny,
        }) as StagehandZodObject);

    const idSchema = coerceSchemaToElementIds(objectSchema);

    ensureTimeRemaining();
    const scrapeResponse: ScrapeResponse<StagehandZodObject> =
      await runScrape<StagehandZodObject>({
        instruction,
        domElements: combinedTree,
        schema: idSchema as StagehandZodObject,
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
    } = scrapeResponse;
    const output = rest as InferStagehandSchema<StagehandZodObject>;

    v3Logger({
      category: "scrape",
      message: completed
        ? "Scrape completed successfully"
        : "Scrape incomplete after processing all data",
      level: 1,
      auxiliary: {
        prompt_tokens: { value: String(prompt_tokens), type: "string" },
        completion_tokens: { value: String(completion_tokens), type: "string" },
        inference_time_ms: {
          value: String(inference_time_ms),
          type: "string",
        },
      },
    });

    // Update SCRAPE metrics from the LLM calls
    this.onMetrics?.(
      V3FunctionName.SCRAPE,
      prompt_tokens,
      completion_tokens,
      reasoning_tokens,
      cached_input_tokens,
      inference_time_ms,
    );

    const referencedOutput = attachXpathReferences(
      output,
      combinedXpathMap ?? {},
    ) as InferStagehandSchema<StagehandZodObject>;

    let finalOutput: unknown = referencedOutput;
    // If we wrapped a non-object schema, unwrap the value
    if (!isObjectSchema && finalOutput && typeof finalOutput === "object") {
      finalOutput = (finalOutput as Record<string, unknown>)[WRAP_KEY];
    }

    if (finalOutput && typeof finalOutput === "object") {
      try {
        Object.defineProperty(finalOutput, SCRAPE_SCHEMA_FIELD, {
          value: effectiveSchema ?? defaultScrapeSchema,
          enumerable: false,
        });
      } catch {
        // ignore if we cannot define
      }
    }

    return finalOutput as ScrapeResult<T>;
  }
}

function attachXpathReferences(
  value: unknown,
  xpathMap: Record<string, string>,
): unknown {
  if (value === null || typeof value === "undefined") {
    return value;
  }

  if (typeof value === "string" || typeof value === "number") {
    const id = String(value) as ScrapeElementId;
    return { id, xpath: xpathMap[String(value)] };
  }

  if (Array.isArray(value)) {
    return value.map((item) => attachXpathReferences(item, xpathMap));
  }

  if (typeof value === "object") {
    const record = value as Record<string | number, unknown>;
    const mapped: Record<string | number, unknown> = {};
    for (const [key, val] of Object.entries(record)) {
      mapped[key] = attachXpathReferences(val, xpathMap);
    }
    return mapped;
  }

  return value;
}

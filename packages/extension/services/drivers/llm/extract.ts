import type { LLMImageContent } from "@browserbasehq/stagehand-protocol/types";
import { z } from "zod/v4";
import * as inference from "../../../inference.js";
import type { ZodPathSegments } from "../../../types/private/internal.js";
import { bytesToBase64 } from "../../../understudy/fileUploadUtils.js";
import { injectUrls, transformSchema } from "../../../utils.js";
import type { CompletionJudge, ExtractDriver } from "../types.js";

const WRAP_KEY = "value";

/** Replaces URL strings with numeric DOM IDs until extraction has resolved the page's URL map. */
export function transformUrlStringsToNumericIds<Schema extends z.ZodType>(
  schema: Schema,
): [z.ZodType, ZodPathSegments[]] {
  const [finalSchema, urlPaths] = transformSchema(schema, []);
  return [finalSchema, urlPaths];
}

/**
 * extract() by language model: one inference fills the schema from the page outline (and the
 * screenshot, when there is one); a second checks completion unless a `completionJudge` is
 * given to do that instead.
 */
export function llmExtractDriver(
  options: { completionJudge?: CompletionJudge } = {},
): ExtractDriver {
  const { completionJudge } = options;
  return {
    name: "llm",
    async resolve(request) {
      const { instruction, schema, snapshot, screenshot, ensureTimeRemaining, logger, llm } =
        request;

      // Models answer in objects; a bare schema is wrapped for the call and unwrapped after.
      const isObjectSchema = schema instanceof z.ZodObject;
      const objectSchema: z.ZodObject = isObjectSchema ? schema : z.object({ [WRAP_KEY]: schema });
      const [transformedSchema, urlFieldPaths] = transformUrlStringsToNumericIds(objectSchema);
      const screenshotContent: LLMImageContent | undefined = screenshot
        ? { type: "image", data: bytesToBase64(screenshot), mimeType: "image/png" }
        : undefined;

      ensureTimeRemaining();
      const response = await inference.extract<z.ZodObject>({
        instruction,
        domElements: snapshot.tree,
        schema: transformedSchema as z.ZodObject,
        generate: (input) => llm.generate(input),
        userProvidedInstructions: llm.systemPrompt,
        screenshot: screenshotContent,
        ...(completionJudge
          ? { judgeCompleted: (extracted: unknown) => completionJudge(extracted, request) }
          : {}),
      });
      llm.record(response);
      ensureTimeRemaining();

      const {
        metadata: { completed },
        prompt_tokens,
        completion_tokens,
        reasoning_tokens: _reasoningTokens,
        cached_input_tokens: _cachedInputTokens,
        inference_time_ms,
        ...rest
      } = response;
      let output: unknown = rest;
      for (const { segments } of urlFieldPaths) {
        injectUrls(output as Record<string, unknown>, segments, snapshot.urlMap);
      }
      if (!isObjectSchema && output && typeof output === "object") {
        output = (output as Record<string, unknown>)[WRAP_KEY];
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
      return { kind: "resolved", data: output };
    },
  };
}

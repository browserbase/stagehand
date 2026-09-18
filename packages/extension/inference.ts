import { z } from "zod/v4";
import type {
  LLMGenerateParams,
  LLMGenerateResult,
  LLMImageContent,
  LLMMessage,
  LLMUsage,
  Variables,
} from "@browserbasehq/stagehand-protocol/types";
import {
  buildActSystemPrompt,
  buildExtractSystemPrompt,
  buildExtractUserPrompt,
  buildMetadataPrompt,
  buildMetadataSystemPrompt,
  buildObserveSystemPrompt,
  buildObserveUserMessage,
} from "./prompt.js";
import { SupportedUnderstudyAction } from "./types/private/handlers.js";

type GenerateLlm = (params: LLMGenerateParams) => Promise<LLMGenerateResult>;

const ExtractMetadataSchema = z.object({
  progress: z
    .string()
    .describe("progress of what has been extracted so far, as concise as possible"),
  completed: z
    .boolean()
    .describe(
      "true if the goal is now accomplished. Use this conservatively, only when sure that the goal has been completed.",
    ),
});

const ObservationSchema = z
  .object({
    elements: z.array(
      z
        .object({
          elementId: z
            .string()
            .regex(/^\d+-\d+$/)
            .describe(
              "The complete frame ordinal and backend node ID copied from the accessibility tree, without square brackets.",
            ),
          description: z
            .string()
            .describe("A description of the accessible element and its purpose."),
          method: z
            .enum(SupportedUnderstudyAction)
            .describe("The supported browser interaction method for this element."),
          arguments: z
            .array(z.string())
            .describe("The arguments to pass to the selected interaction method."),
        })
        .strict(),
    ),
  })
  .strict();

const ActInferenceSchema = z
  .object({
    action: z
      .object({
        elementId: z
          .string()
          .regex(/^\d+-\d+$/)
          .describe(
            "The complete frame ordinal and backend node ID copied from the accessibility tree, without square brackets.",
          ),
        description: z.string().describe("A description of the element and its purpose."),
        method: z
          .enum(SupportedUnderstudyAction)
          .describe("The supported browser interaction method to execute."),
        arguments: z
          .array(z.string())
          .describe("The arguments to pass to the selected interaction method."),
      })
      .strict()
      .nullable()
      .describe("The element to act on, or null when no matching element exists."),
    twoStep: z
      .boolean()
      .describe("Whether the selected interaction requires a second action to finish the request."),
  })
  .strict();

function promptText(prompt: { content: unknown }): string {
  if (typeof prompt.content !== "string") {
    throw new TypeError("Structured LLM prompts must contain text");
  }
  return prompt.content;
}

async function generateStructured<Schema extends z.ZodType>(
  generate: GenerateLlm,
  name: string,
  schema: Schema,
  systemPrompt: string,
  userPrompt: string | LLMMessage,
): Promise<{ data: z.output<Schema>; usage?: LLMUsage; durationMs: number }> {
  const startedAt = Date.now();
  const response = await generate({
    systemPrompt,
    messages: [
      typeof userPrompt === "string"
        ? { role: "user", content: { type: "text", text: userPrompt } }
        : userPrompt,
    ],
    responseFormat: {
      type: "json_schema",
      name,
      schema: z.json().parse(z.toJSONSchema(schema)),
    },
  });

  if (response.outputFormat !== "json_schema") {
    throw new TypeError(`${name} generation returned text instead of structured content`);
  }

  return {
    data: schema.parse(response.structuredContent),
    usage: response.usage,
    durationMs: Date.now() - startedAt,
  };
}

export async function extract<T extends z.ZodObject>(params: {
  instruction: string;
  domElements: string;
  schema: T;
  generate: GenerateLlm;
  userProvidedInstructions?: string;
  screenshot?: LLMImageContent;
  /** Replaces the metadata LLM call; a throw falls back to it. */
  judgeCompleted?: (extracted: unknown) => Promise<boolean>;
}): Promise<
  z.infer<T> & {
    metadata: z.infer<typeof ExtractMetadataSchema>;
    prompt_tokens: number;
    completion_tokens: number;
    reasoning_tokens: number;
    cached_input_tokens: number;
    inference_time_ms: number;
  }
> {
  const { instruction, domElements, schema, generate, userProvidedInstructions, screenshot } =
    params;
  const extraction = await generateStructured(
    generate,
    "Extraction",
    schema,
    promptText(buildExtractSystemPrompt(false, userProvidedInstructions, Boolean(screenshot))),
    buildExtractUserPrompt(instruction, domElements, false, screenshot),
  );
  const judged = params.judgeCompleted
    ? await params.judgeCompleted(extraction.data).catch(() => undefined)
    : undefined;
  const metadata =
    judged === undefined
      ? await generateStructured(
          generate,
          "Metadata",
          ExtractMetadataSchema,
          promptText(buildMetadataSystemPrompt()),
          promptText(buildMetadataPrompt(instruction, extraction.data)),
        )
      : { data: { progress: "", completed: judged }, usage: undefined, durationMs: 0 };

  return {
    ...extraction.data,
    metadata: metadata.data,
    prompt_tokens: (extraction.usage?.inputTokens ?? 0) + (metadata.usage?.inputTokens ?? 0),
    completion_tokens: (extraction.usage?.outputTokens ?? 0) + (metadata.usage?.outputTokens ?? 0),
    reasoning_tokens:
      (extraction.usage?.reasoningTokens ?? 0) + (metadata.usage?.reasoningTokens ?? 0),
    cached_input_tokens:
      (extraction.usage?.cachedInputTokens ?? 0) + (metadata.usage?.cachedInputTokens ?? 0),
    inference_time_ms: extraction.durationMs + metadata.durationMs,
  };
}

export async function observe(params: {
  instruction: string;
  domElements: string;
  generate: GenerateLlm;
  userProvidedInstructions?: string;
  supportedActions?: string[];
  variables?: Variables;
}): Promise<{
  elements: z.output<typeof ObservationSchema>["elements"];
  prompt_tokens: number;
  completion_tokens: number;
  reasoning_tokens: number;
  cached_input_tokens: number;
  inference_time_ms: number;
}> {
  const {
    instruction,
    domElements,
    generate,
    userProvidedInstructions,
    supportedActions,
    variables,
  } = params;
  const observation = await generateStructured(
    generate,
    "Observation",
    ObservationSchema,
    promptText(buildObserveSystemPrompt(userProvidedInstructions, supportedActions, variables)),
    promptText(buildObserveUserMessage(instruction, domElements)),
  );

  return {
    elements: observation.data.elements,
    prompt_tokens: observation.usage?.inputTokens ?? 0,
    completion_tokens: observation.usage?.outputTokens ?? 0,
    reasoning_tokens: observation.usage?.reasoningTokens ?? 0,
    cached_input_tokens: observation.usage?.cachedInputTokens ?? 0,
    inference_time_ms: observation.durationMs,
  };
}

export async function act(params: {
  instruction: string;
  domElements: string;
  generate: GenerateLlm;
  userProvidedInstructions?: string;
}): Promise<{
  element: z.output<typeof ActInferenceSchema>["action"];
  twoStep: boolean;
  prompt_tokens: number;
  completion_tokens: number;
  reasoning_tokens: number;
  cached_input_tokens: number;
  inference_time_ms: number;
}> {
  const { instruction, domElements, generate, userProvidedInstructions } = params;
  const result = await generateStructured(
    generate,
    "Act",
    ActInferenceSchema,
    promptText(buildActSystemPrompt(userProvidedInstructions)),
    promptText(buildObserveUserMessage(instruction, domElements)),
  );

  return {
    element: result.data.action,
    twoStep: result.data.twoStep,
    prompt_tokens: result.usage?.inputTokens ?? 0,
    completion_tokens: result.usage?.outputTokens ?? 0,
    reasoning_tokens: result.usage?.reasoningTokens ?? 0,
    cached_input_tokens: result.usage?.cachedInputTokens ?? 0,
    inference_time_ms: result.durationMs,
  };
}

const ActTextArgumentSchema = z
  .object({
    text: z
      .string()
      .nullable()
      .describe(
        "The exact text the instruction wants typed, copied verbatim from the instruction, or the %variable% placeholder that stands for it. Null when the instruction does not say what to type.",
      ),
  })
  .strict();

/**
 * Argument-only inference for the experimental Jev act path: no page content,
 * just the instruction, returning the literal text to type. The element is
 * chosen elsewhere.
 */
export async function actTextArgument(params: {
  instruction: string;
  variableNames: string[];
  generate: GenerateLlm;
}): Promise<{
  text: string | null;
  prompt_tokens: number;
  completion_tokens: number;
  reasoning_tokens: number;
  cached_input_tokens: number;
  inference_time_ms: number;
}> {
  const variables =
    params.variableNames.length > 0
      ? ` Declared variables: ${params.variableNames.map((name) => `%${name}%`).join(", ")}; if one of them stands for the text, return it as written including the percent signs.`
      : "";
  const result = await generateStructured(
    params.generate,
    "ActTextArgument",
    ActTextArgumentSchema,
    `You extract one argument from a browser-automation instruction: the literal text the user wants typed into a field. Copy it verbatim from the instruction; never paraphrase, translate, or invent. Do not return the name of the field.${variables}`,
    `instruction: ${params.instruction}`,
  );
  return {
    text: result.data.text,
    prompt_tokens: result.usage?.inputTokens ?? 0,
    completion_tokens: result.usage?.outputTokens ?? 0,
    reasoning_tokens: result.usage?.reasoningTokens ?? 0,
    cached_input_tokens: result.usage?.cachedInputTokens ?? 0,
    inference_time_ms: result.durationMs,
  };
}

/**
 * Argument-only inference for a WebMCP tool Jev already chose: the prompt is
 * one tool, not the catalog, and the tool's own input schema shapes the answer.
 */
export async function toolArguments(params: {
  instruction: string;
  tool: { name: string; description: string; inputSchema?: Record<string, unknown> };
  variableNames: string[];
  generate: GenerateLlm;
}): Promise<{
  input: Record<string, unknown> | null;
  prompt_tokens: number;
  completion_tokens: number;
  reasoning_tokens: number;
  cached_input_tokens: number;
  inference_time_ms: number;
}> {
  const startedAt = Date.now();
  const variables =
    params.variableNames.length > 0
      ? ` Declared variables: ${params.variableNames.map((name) => `%${name}%`).join(", ")}; when one stands for a value, return it as written including the percent signs.`
      : "";
  const response = await params.generate({
    systemPrompt: `You fill in the input of one tool from a user's request. Use only values the request states or clearly implies; leave optional parameters out otherwise.${variables}`,
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `tool: ${JSON.stringify({ name: params.tool.name, description: params.tool.description })}\nrequest: ${params.instruction}`,
        },
      },
    ],
    responseFormat: {
      type: "json_schema",
      name: "ToolInput",
      schema: z.json().parse({ type: "object", ...params.tool.inputSchema }),
    },
  });
  const content = response.outputFormat === "json_schema" ? response.structuredContent : null;
  return {
    input:
      content && typeof content === "object" && !Array.isArray(content)
        ? (content as Record<string, unknown>)
        : null,
    prompt_tokens: response.usage?.inputTokens ?? 0,
    completion_tokens: response.usage?.outputTokens ?? 0,
    reasoning_tokens: response.usage?.reasoningTokens ?? 0,
    cached_input_tokens: response.usage?.cachedInputTokens ?? 0,
    inference_time_ms: Date.now() - startedAt,
  };
}

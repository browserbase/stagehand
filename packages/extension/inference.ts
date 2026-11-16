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
  buildObserveSystemPrompt,
  buildObserveUserMessage,
} from "./prompt.js";
import { SupportedUnderstudyAction } from "./types/private/handlers.js";

type GenerateLlm = (params: LLMGenerateParams) => Promise<LLMGenerateResult>;

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

function includesNumericSchema(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(includesNumericSchema);
  const schema = value as Record<string, unknown>;
  if (schema.type === "number" || schema.type === "integer") return true;
  if (
    Array.isArray(schema.type) &&
    schema.type.some((type) => type === "number" || type === "integer")
  )
    return true;
  return Object.values(schema).some(includesNumericSchema);
}

export async function extract<T extends z.ZodObject>(params: {
  instruction: string;
  domElements: string;
  schema: T;
  generate: GenerateLlm;
  userProvidedInstructions?: string;
  screenshot?: LLMImageContent;
}) {
  const { instruction, domElements, schema, generate, userProvidedInstructions, screenshot } =
    params;
  return generateStructured(
    generate,
    "Extraction",
    schema,
    promptText(
      buildExtractSystemPrompt(
        false,
        userProvidedInstructions,
        Boolean(screenshot),
        includesNumericSchema(z.toJSONSchema(schema)),
      ),
    ),
    buildExtractUserPrompt(instruction, domElements, false, screenshot),
  );
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

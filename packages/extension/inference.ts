import { z } from "zod/v4";
import { isJsonObject } from "../protocol/dynamic-json-schema.js";
import type {
  LLMGenerateParams,
  LLMGenerateResult,
  LLMImageContent,
  LLMMessage,
  LLMUsage,
  Variables,
} from "../protocol/types.js";
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
import type { StructuredOutputContract } from "./llm/structuredOutput.js";
import {
  createZodStructuredOutputContract,
  StructuredOutputValidationError,
} from "./llm/structuredOutput.js";

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

const ExtractMetadataContract = createZodStructuredOutputContract(
  "Metadata",
  ExtractMetadataSchema,
);
const ObservationContract = createZodStructuredOutputContract("Observation", ObservationSchema);
const ActInferenceContract = createZodStructuredOutputContract("Act", ActInferenceSchema);

function promptText(prompt: { content: unknown }): string {
  if (typeof prompt.content !== "string") {
    throw new TypeError("Structured LLM prompts must contain text");
  }
  return prompt.content;
}

async function generateStructured<Output>(
  generate: GenerateLlm,
  contract: StructuredOutputContract<Output>,
  systemPrompt: string,
  userPrompt: string | LLMMessage,
): Promise<{
  data: Output;
  usage?: LLMUsage;
  durationMs: number;
}> {
  const { name } = contract;
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
      schema: contract.jsonSchema,
    },
  });
  if (response.outputFormat !== "json_schema") {
    throw new TypeError(`${name} generation returned text instead of structured content`);
  }
  const validation = contract.validate(response.structuredContent);
  if (validation.issues) throw new StructuredOutputValidationError(validation.issues);
  return {
    data: validation.value,
    usage: response.usage,
    durationMs: Date.now() - startedAt,
  };
}

export async function extract(params: {
  instruction: string;
  domElements: string;
  schema: StructuredOutputContract;
  generate: GenerateLlm;
  userProvidedInstructions?: string;
  screenshot?: LLMImageContent;
}): Promise<
  Record<string, unknown> & {
    metadata: z.output<typeof ExtractMetadataSchema>;
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
    schema,
    promptText(buildExtractSystemPrompt(false, userProvidedInstructions, Boolean(screenshot))),
    buildExtractUserPrompt(instruction, domElements, false, screenshot),
  );
  if (!isJsonObject(extraction.data)) {
    throw new TypeError("Extraction schema must produce an object");
  }
  const metadata = await generateStructured(
    generate,
    ExtractMetadataContract,
    promptText(buildMetadataSystemPrompt()),
    promptText(buildMetadataPrompt(instruction, extraction.data)),
  );
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
    ObservationContract,
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
    ActInferenceContract,
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

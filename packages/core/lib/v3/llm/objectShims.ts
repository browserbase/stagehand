/**
 * Thin shims that wrap generateText and streamText with Output.object({ schema })
 * as the replacement for deprecated generateObject and streamObject from the AI SDK.
 * Callers must supply a schema; it is passed through to Output.object() for structured output.
 */

import { generateText, streamText, Output } from "ai";
import type { ModelMessage } from "ai";
import type { StagehandZodSchema } from "../zodCompat";

type GenerateTextOptions = Parameters<typeof generateText>[0];
type StreamTextOptions = Parameters<typeof streamText>[0];

type SchemaMeta = {
  schema: StagehandZodSchema;
  schemaName?: string;
  schemaDescription?: string;
};

/** Options for generateObjectShim: generateText options with required schema and either prompt or messages. */
export type GenerateObjectShimOptions =
  | (Omit<GenerateTextOptions, "output" | "messages"> &
      SchemaMeta & { prompt: string })
  | (Omit<GenerateTextOptions, "output" | "prompt"> &
      SchemaMeta & { messages: ModelMessage[] });

/** Options for streamObjectShim: streamText options with required schema and either prompt or messages. */
export type StreamObjectShimOptions =
  | (Omit<StreamTextOptions, "output" | "messages"> &
      SchemaMeta & { prompt: string })
  | (Omit<StreamTextOptions, "output" | "prompt"> &
      SchemaMeta & { messages: ModelMessage[] });

/**
 * Wraps generateText with Output.object({ schema }) so a schema is always supplied.
 * Returns a result shaped like the deprecated generateObject: { object, ...rest }
 * so that destructuring { object } continues to work.
 */
export async function generateObjectShim<SCHEMA extends StagehandZodSchema>(
  options: GenerateObjectShimOptions & { schema: SCHEMA },
) {
  const { schema, schemaName, schemaDescription, ...rest } = options;

  if (schema == null) {
    throw new Error("generateObjectShim requires a schema");
  }

  const output = Output.object({
    schema,
    ...(schemaName != null && { name: schemaName }),
    ...(schemaDescription != null && { description: schemaDescription }),
  });

  if (
    ("prompt" in rest && rest.prompt !== undefined) ||
    ("messages" in rest && rest.messages !== undefined)
  ) {
    const result = await generateText({ ...rest, output });
    // Explicitly copy getter-based properties that would be lost in a spread,
    // so callers who destructure { object, usage, finishReason } get valid values.
    return {
      ...result,
      object: result.output,
      output: result.output,
      usage: result.usage,
      finishReason: result.finishReason,
      text: result.text,
      reasoning: result.reasoning,
      files: result.files,
      sources: result.sources,
    };
  }

  throw new Error("generateObjectShim requires either prompt or messages");
}

/**
 * Wraps streamText with Output.object({ schema }) so a schema is always supplied.
 * Returns a result with partialObjectStream (alias for partialOutputStream)
 * for compatibility with deprecated streamObject return shape.
 */
export function streamObjectShim<SCHEMA extends StagehandZodSchema>(
  options: StreamObjectShimOptions & { schema: SCHEMA },
) {
  const { schema, schemaName, schemaDescription, ...rest } = options;

  if (schema == null) {
    throw new Error("streamObjectShim requires a schema");
  }

  const output = Output.object({
    schema,
    ...(schemaName != null && { name: schemaName }),
    ...(schemaDescription != null && { description: schemaDescription }),
  });

  if (
    ("prompt" in rest && rest.prompt !== undefined) ||
    ("messages" in rest && rest.messages !== undefined)
  ) {
    const result = streamText({ ...rest, output });
    // Explicitly copy getter-based properties that would be lost in a spread,
    // and alias partialOutputStream → partialObjectStream for backwards compat.
    return {
      ...result,
      partialObjectStream: result.partialOutputStream,
      output: result.output,
      usage: result.usage,
      finishReason: result.finishReason,
      text: result.text,
      reasoning: result.reasoning,
      files: result.files,
      sources: result.sources,
    };
  }

  throw new Error("streamObjectShim requires either prompt or messages");
}

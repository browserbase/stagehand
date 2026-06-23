import { generateText, ModelMessage, LanguageModel, ToolSet } from "ai";
import { z } from "zod";
import { tool } from "ai";
import { LogLine } from "../../types/public/logs.js";
import {
  anthropicFallbacksOptions,
  rejectsForcedToolUse,
} from "../../llm/anthropicOptions.js";
import { StagehandZodObject } from "../../zodCompat.js";
import { getZFactory } from "../../../utils.js";
import type { StagehandZodSchema } from "../../zodCompat.js";

interface DoneResult {
  reasoning: string;
  taskComplete: boolean;
  messages: ModelMessage[];
  output?: Record<string, unknown>;
}

/**
 * Recursively drop keys whose value is `undefined` from plain objects (and
 * recurse into arrays / plain objects), leaving class instances, Dates, typed
 * arrays, primitives and `null` untouched.
 *
 * The AI SDK validates `providerOptions` as `providerMetadataSchema`, whose leaf
 * values are `jsonValueSchema` (null | string | number | boolean | object |
 * array) — `undefined` is not allowed. SDK-generated messages (e.g. OpenAI
 * reasoning / tool parts) can carry nested `undefined` values, so re-submitting
 * them verbatim makes standardizePrompt reject the whole prompt with
 * "messages must be a ModelMessage[]". `JSON.stringify` hides these (it omits
 * undefined), which is why the failure is invisible in logs. Stripping them is
 * equivalent to a JSON round-trip and makes the prompt valid again.
 */
function stripUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((v) => stripUndefinedDeep(v)) as unknown as T;
  }
  if (value !== null && typeof value === "object") {
    const proto = Object.getPrototypeOf(value);
    if (proto === Object.prototype || proto === null) {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (v !== undefined) out[k] = stripUndefinedDeep(v);
      }
      return out as T;
    }
  }
  return value;
}

/**
 * Sanitize the accumulated run history before it is re-submitted to a fresh
 * generateText call. See {@link stripUndefinedDeep}.
 */
export function sanitizeMessagesForResubmission(
  messages: ModelMessage[],
): ModelMessage[] {
  return messages.map((message) => stripUndefinedDeep(message));
}

function buildBaseDoneSchema(factory: typeof z) {
  return factory.object({
    reasoning: factory
      .string()
      .describe("Brief summary of what actions were taken and the outcome"),
    taskComplete: factory
      .boolean()
      .describe("true if the task was fully completed, false otherwise"),
  });
}

/**
 * Force a done tool call at the end of an agent run.
 * This ensures we always get a structured final response,
 * even if the main loop ended without calling done.
 */
export async function handleDoneToolCall(options: {
  model: LanguageModel;
  inputMessages: ModelMessage[];
  instruction: string;
  outputSchema?: StagehandZodObject;
  logger: (message: LogLine) => void;
}): Promise<DoneResult> {
  const { model, inputMessages, instruction, outputSchema, logger } = options;

  logger({
    category: "agent",
    message: "Agent calling tool: done",
    level: 1,
  });
  // Use the same Zod version as the user's outputSchema to avoid v3/v4 mixing
  const factory = outputSchema
    ? getZFactory(outputSchema as StagehandZodSchema)
    : z;
  const baseDoneSchema = buildBaseDoneSchema(factory);

  // Merge base done schema with user-provided output schema if present
  const doneToolSchema = outputSchema
    ? baseDoneSchema.extend({
        output: outputSchema.describe(
          "The specific data the user requested from this task",
        ),
      })
    : baseDoneSchema;

  const outputInstructions = outputSchema
    ? `\n\nThe user also requested the following information from this task. Provide it in the "output" field:\n${JSON.stringify(
        Object.fromEntries(
          Object.entries(outputSchema.shape).map(
            ([key, value]: [string, StagehandZodSchema]) => [
              key,
              value.description || "no description",
            ],
          ),
        ),
        null,
        2,
      )}`
    : "";

  const systemPrompt = `You are a web automation assistant that was tasked with completing a task.

The task was:
"${instruction}"

Review what was accomplished and provide your final assessment in whether the task was completed successfully. you have been provided with the history of the actions taken so far, use this to determine if the task was completed successfully.${outputInstructions}

Call the "done" tool with:
1. A brief summary of what was done
2. Whether the task was completed successfully${outputSchema ? "\n3. The requested output data based on what you found" : ""}`;

  const doneTool = tool({
    description: outputSchema
      ? "Complete the task with your assessment and the requested output data."
      : "Complete the task with your final assessment.",
    inputSchema: doneToolSchema,
    execute: async (params) => {
      return { success: true, ...params };
    },
  });

  const userPrompt: ModelMessage = {
    role: "user",
    content: outputSchema
      ? "Provide your final assessment and the requested output data."
      : "Provide your final assessment.",
  };

  const modelId = typeof model === "string" ? model : model.modelId;
  const fallbacks = anthropicFallbacksOptions(modelId);

  // Models whose always-on thinking rejects forced tool use go straight to
  // "auto" — the prompt already instructs calling "done", and the
  // no-tool-call case below handles a plain-text answer.
  const result = await generateText({
    model,
    system: systemPrompt,
    messages: [...sanitizeMessagesForResubmission(inputMessages), userPrompt],
    tools: { done: doneTool } as ToolSet,
    toolChoice: rejectsForcedToolUse(modelId)
      ? "auto"
      : { type: "tool", toolName: "done" },
    providerOptions: {
      google: { mediaResolution: "MEDIA_RESOLUTION_HIGH" },
      openai: { store: false },
      ...(fallbacks ? { anthropic: fallbacks } : {}),
    },
  });

  const doneToolCall = result.toolCalls?.find((tc) => tc.toolName === "done");
  const outputMessages: ModelMessage[] = [
    userPrompt,
    ...(result.response?.messages || []),
  ];

  if (!doneToolCall) {
    return {
      reasoning: result.text || "Task execution completed",
      taskComplete: false,
      messages: outputMessages,
    };
  }

  const input = doneToolCall.input as {
    reasoning: string;
    taskComplete: boolean;
    output?: Record<string, unknown>;
  };
  logger({
    category: "agent",
    message: `Task completed`,
    level: 1,
  });

  return {
    reasoning: input.reasoning,
    taskComplete: input.taskComplete,
    messages: outputMessages,
    output: input.output,
  };
}

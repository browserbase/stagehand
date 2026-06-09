import { generateText, ModelMessage, LanguageModel, ToolSet } from "ai";
import { z } from "zod";
import { tool } from "ai";
import { LogLine } from "../../types/public/logs.js";
import { StagehandZodObject } from "../../zodCompat.js";
import { getZFactory } from "../../../utils.js";
import type { StagehandZodSchema } from "../../zodCompat.js";

interface DoneResult {
  reasoning: string;
  taskComplete: boolean;
  messages: ModelMessage[];
  output?: Record<string, unknown>;
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

  // Force a final "done" tool call. Some models (e.g. claude-fable-5) reject
  // forced tool use with "tool_choice forces tool use is not compatible with
  // this model". Try forced first; on that specific error, retry with toolChoice
  // "auto" — the prompt already instructs the model to call "done", and the
  // no-tool-call branch below handles a plain-text answer.
  const baseRequest = {
    model,
    system: systemPrompt,
    messages: [...inputMessages, userPrompt],
    tools: { done: doneTool } as ToolSet,
    providerOptions: {
      google: { mediaResolution: "MEDIA_RESOLUTION_HIGH" },
      openai: { store: false },
    },
  } satisfies Omit<Parameters<typeof generateText>[0], "toolChoice">;

  let result: Awaited<ReturnType<typeof generateText>>;
  try {
    result = await generateText({
      ...baseRequest,
      toolChoice: { type: "tool", toolName: "done" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Only swallow the tool_choice incompatibility — rethrow anything else.
    if (!/tool_choice|tool choice/i.test(message)) throw error;
    logger({
      category: "agent",
      message: `Forced "done" tool call rejected; retrying with toolChoice "auto" (${message})`,
      level: 1,
    });
    result = await generateText({ ...baseRequest, toolChoice: "auto" });
  }

  const doneToolCall = result.toolCalls.find((tc) => tc.toolName === "done");
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

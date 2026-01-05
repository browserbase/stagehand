import { generateText, ModelMessage, LanguageModel, ToolSet } from "ai";
import { z } from "zod";
import { tool } from "ai";

interface CloseResult {
  reasoning: string;
  taskComplete: boolean;
  messages: ModelMessage[];
}

const closeToolSchema = z.object({
  reasoning: z
    .string()
    .describe("Brief summary of what actions were taken and the outcome"),
  taskComplete: z
    .boolean()
    .describe("true if the task was fully completed, false otherwise"),
});

/**
 * Force a close tool call at the end of an agent run.
 * This ensures we always get a structured final response,
 * even if the main loop ended without calling close.
 */
export async function handleCloseToolCall(options: {
  model: LanguageModel;
  inputMessages: ModelMessage[];
  instruction: string;
}): Promise<CloseResult> {
  const { model, inputMessages, instruction } = options;

  const systemPrompt = `You are evaluating a web automation task that was just attempted.

The original task was:
"${instruction}"

Review the conversation history to determine:
1. Whether the task was successfully completed
2. If it was not completed, why not. What went wrong? 

You must call the "close" tool with your assessment.`;

  const closeTool = tool({
    description: "Provide your final assessment of the task completion status.",
    inputSchema: closeToolSchema,
    execute: async ({ reasoning, taskComplete }) => {
      return { success: true, reasoning, taskComplete };
    },
  });

  const userPrompt: ModelMessage = {
    role: "user",
    content: "Based on the actions taken, did the task complete successfully? Call the close tool with your assessment.",
  };

  const result = await generateText({
    model,
    system: systemPrompt,
    messages: [...inputMessages, userPrompt],
    tools: { close: closeTool } as ToolSet,
    toolChoice: { type: "tool", toolName: "close" },
    maxOutputTokens: 512,
  });

  const closeToolCall = result.toolCalls.find((tc) => tc.toolName === "close");
  // Include the user prompt + response messages for complete history
  const outputMessages: ModelMessage[] = [userPrompt, ...(result.response?.messages || [])];

  if (!closeToolCall) {
    return {
      reasoning: result.text || "Task execution completed",
      taskComplete: false,
      messages: outputMessages,
    };
  }

  const input = closeToolCall.input as z.infer<typeof closeToolSchema>;

  return {
    reasoning: input.reasoning,
    taskComplete: input.taskComplete,
    messages: outputMessages,
  };
}


import {
  actTools,
  buildActSystemPrompt,
  buildActUserPrompt,
  buildAskSystemPrompt,
  buildExtractSystemPrompt,
  buildExtractUserPrompt,
  buildObserveSystemPrompt,
  buildObserveUserMessage,
  buildAskUserPrompt,
} from "./prompt";
import { z } from "zod";
import { LLMProvider } from "./llm/LLMProvider";
import { ChatMessage } from "./llm/LLMClient";

export async function act({
  action,
  domElements,
  steps,
  llmProvider,
  modelName,
}: {
  action: string;
  steps?: string;
  domElements: string;
  llmProvider: LLMProvider;
  modelName: string;
}): Promise<{
  method: string;
  element: number;
  args: any[];
  completed: boolean;
  step: string;
  why?: string;
} | null> {
  const llmClient = llmProvider.getClient(modelName);
  const response = await llmClient.createChatCompletion({
    model: modelName,
    messages: [
      buildActSystemPrompt() as ChatMessage,
      buildActUserPrompt(action, steps, domElements) as ChatMessage,
    ],
    temperature: 0.1,
    top_p: 1,
    frequency_penalty: 0,
    presence_penalty: 0,
    tool_choice: "auto",
    tools: actTools,
  });

  const toolCalls = response.choices[0].message.tool_calls;
  if (toolCalls && toolCalls.length > 0) {
    if (toolCalls[0].function.name === "skipSection") {
      return null;
    }
    return JSON.parse(toolCalls[0].function.arguments);
  } else {
    throw new Error("No tool calls found in response");
  }
}

export async function extract({
  instruction,
  progress,
  previouslyExtractedContent,
  domElements,
  schema,
  llmProvider,
  modelName,
}: {
  instruction: string;
  progress: string;
  previouslyExtractedContent: any;
  domElements: string;
  schema: z.ZodObject<any>;
  llmProvider: LLMProvider;
  modelName: string;
}) {
  const llmClient = llmProvider.getClient(modelName);

  const fullSchema = schema.extend({
    metadata: z.object({
      progress: z
        .string()
        .describe("progress of what has been extracted so far"),
      completed: z.boolean().describe("true if the goal is now accomplished"),
    }),
  });

  return llmClient.createExtraction({
    model: modelName,
    messages: [
      buildExtractSystemPrompt() as ChatMessage,
      buildExtractUserPrompt(
        instruction,
        progress,
        previouslyExtractedContent,
        domElements,
      ) as ChatMessage,
    ],
    response_model: {
      schema: fullSchema,
      name: "Extraction",
    },
    temperature: 0.1,
    top_p: 1,
    frequency_penalty: 0,
    presence_penalty: 0,
  });
}

export async function observe({
  observation,
  domElements,
  llmProvider,
  modelName,
}: {
  observation: string;
  domElements: string;
  llmProvider: LLMProvider;
  modelName: string;
}) {
  const llmClient = llmProvider.getClient(modelName);
  const observationResponse = await llmClient.createChatCompletion({
    model: modelName,
    messages: [
      buildObserveSystemPrompt() as ChatMessage,
      buildObserveUserMessage(observation, domElements) as ChatMessage,
    ],
    temperature: 0.1,
    top_p: 1,
    frequency_penalty: 0,
    presence_penalty: 0,
  });

  const elementId = observationResponse.choices[0].message.content;

  if (!elementId) {
    throw new Error("no response when finding a selector");
  }

  return elementId;
}

export async function ask({
  question,
  llmProvider,
  modelName,
}: {
  question: string;
  llmProvider: LLMProvider;
  modelName: string;
}) {
  const llmClient = llmProvider.getClient(modelName);
  const response = await llmClient.createChatCompletion({
    model: modelName,
    messages: [
      buildAskSystemPrompt() as ChatMessage,
      buildAskUserPrompt(question) as ChatMessage,
    ],
    temperature: 0.1,
    top_p: 1,
    frequency_penalty: 0,
    presence_penalty: 0,
  });

  // The parsing is now handled in the LLM clients
  return response.choices[0].message.content;
}

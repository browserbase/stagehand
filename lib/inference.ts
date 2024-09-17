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
import OpenAI from "openai";
import type { InstructorClient } from "@instructor-ai/instructor";
import { z } from "zod";
import { LLMProvider } from "./LLMProvider";

export async function act({
  action,
  domElements,
  steps,
  llmProvider,
  model_name,
}: {
  action: string;
  steps?: string;
  domElements: string;
  llmProvider: LLMProvider;
  model_name: string;
}): Promise<{
  method: string;
  element: number;
  args: any[];
  completed: boolean;
  step: string;
  why?: string;
} | null> {
  const client = llmProvider.getChatClient(model_name);
  const response = await client.chat.completions.create({
    model: model_name,
    messages: [
      buildActSystemPrompt(),
      buildActUserPrompt(action, steps, domElements),
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
  domElements,
  schema,
  llmProvider,
  model_name,
}: {
  instruction: string;
  progress: string;
  domElements: string;
  schema: z.ZodObject<any>;
  llmProvider: LLMProvider;
  model_name: string;
}) {
  const client = llmProvider.getExtractionClient(model_name);
  const fullSchema = schema.extend({
    progress: z.string().describe("progress of what has been extracted so far"),
    completed: z.boolean().describe("true if the goal is now accomplished"),
  });

  return client.chat.completions.create({
    model: model_name,
    messages: [
      buildExtractSystemPrompt(),
      buildExtractUserPrompt(instruction, progress, domElements),
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
  model_name,
}: {
  observation: string;
  domElements: string;
  llmProvider: LLMProvider;
  model_name: string;
}) {
  const client = llmProvider.getChatClient(model_name);
  const observationResponse = await client.chat.completions.create({
    model: model_name,
    messages: [
      buildObserveSystemPrompt(),
      buildObserveUserMessage(observation, domElements),
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
  model_name,
}: {
  question: string;
  llmProvider: LLMProvider;
  model_name: string;
}) {
  const client = llmProvider.getChatClient(model_name);
  const response = await client.chat.completions.create({
    model: model_name,
    messages: [buildAskSystemPrompt(), buildAskUserPrompt(question)],

    temperature: 0.1,
    top_p: 1,
    frequency_penalty: 0,
    presence_penalty: 0,
  });

  return response.choices[0].message.content;
}

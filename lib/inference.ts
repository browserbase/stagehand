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
  buildFilterSystemPrompt,
  buildFilterUserPrompt,
  buildMetadataSystemPrompt,
  buildMetadataPrompt,
} from "./prompt";
import { z } from "zod";
import { LLMProvider } from "./llm/LLMProvider";
import { AnnotatedScreenshotText, ChatMessage } from "./llm/LLMClient";

export async function act({
  action,
  domElements,
  steps,
  llmProvider,
  modelName,
  screenshot,
  retries = 0,
}: {
  action: string;
  steps?: string;
  domElements: string;
  llmProvider: LLMProvider;
  modelName: string;
  screenshot?: Buffer;
  retries?: number;
}): Promise<{
  method: string;
  element: number;
  args: any[];
  completed: boolean;
  step: string;
  why?: string;
} | null> {
  const llmClient = llmProvider.getClient(modelName);
  const messages = [
    buildActSystemPrompt() as ChatMessage,
    buildActUserPrompt(action, steps, domElements) as ChatMessage,
  ];

  const response = await llmClient.createChatCompletion({
    model: modelName,
    messages,
    temperature: 0.1,
    top_p: 1,
    frequency_penalty: 0,
    presence_penalty: 0,
    tool_choice: "auto",
    tools: actTools,
    image: screenshot
      ? { buffer: screenshot, description: AnnotatedScreenshotText }
      : undefined,
  });

  const toolCalls = response.choices[0].message.tool_calls;
  if (toolCalls && toolCalls.length > 0) {
    if (toolCalls[0].function.name === "skipSection") {
      return null;
    }
    return JSON.parse(toolCalls[0].function.arguments);
  } else {
    if (retries >= 2) {
      console.error("No tool calls found in response");
      return null;
    }

    return act({
      action,
      domElements,
      steps,
      llmProvider,
      modelName,
      retries: retries + 1,
    });
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

  const extractionResponse = await llmClient.createExtraction({
    model: modelName,
    messages: [
      buildExtractSystemPrompt() as ChatMessage,
      buildExtractUserPrompt(instruction, domElements) as ChatMessage,
    ],
    response_model: {
      schema: schema,
      name: "Extraction",
    },
    temperature: 0.1,
    top_p: 1,
    frequency_penalty: 0,
    presence_penalty: 0,
  });

  const filteredResponse = await llmClient.createExtraction({
    model: modelName,
    messages: [
      buildFilterSystemPrompt() as ChatMessage,
      buildFilterUserPrompt(previouslyExtractedContent, extractionResponse) as ChatMessage,
    ],
    response_model: {
      schema: schema,
      name: "FilteredExtraction",
    },
    temperature: 0.1,
    top_p: 1,
    frequency_penalty: 0,
    presence_penalty: 0,
  });

  const metadataSchema = z.object({
    progress: z.string().describe("progress of what has been extracted so far, as concise as possible"),
    completed: z.boolean().describe("true if the goal is now accomplished. Use this conservatively, only when you are sure that the goal has been completed.")
  });

  const metadataResponse = await llmClient.createExtraction({
    model: modelName,
    messages: [
      buildMetadataSystemPrompt() as ChatMessage,
      buildMetadataPrompt(
        progress,
        instruction,
        filteredResponse,
      ) as ChatMessage
    ],
    response_model: {
      name: "Metadata",
      schema: metadataSchema
    },
    temperature: 0.1,
    top_p: 1,
    frequency_penalty: 0,
    presence_penalty: 0
  });

  filteredResponse.metadata = metadataResponse;
  console.log("metadataResponse", metadataResponse)

  return filteredResponse;
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

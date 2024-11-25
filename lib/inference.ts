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
  buildVerifyActCompletionSystemPrompt,
  buildVerifyActCompletionUserPrompt,
  buildRefineSystemPrompt,
  buildRefineUserPrompt,
  buildMetadataSystemPrompt,
  buildMetadataPrompt,
} from "./prompt";
import { z } from "zod";
import { LLMProvider } from "./llm/LLMProvider";
import {
  AnnotatedScreenshotText,
  ChatMessage,
  LLMClient,
} from "./llm/LLMClient";
import { AvailableModel } from "./types";

export async function verifyActCompletion({
  goal,
  steps,
  llmProvider,
  llmClient,
  screenshot,
  domElements,
  logger,
  requestId,
}: {
  goal: string;
  steps: string;
  llmProvider: LLMProvider;
  llmClient: LLMClient;
  screenshot?: Buffer;
  domElements?: string;
  logger: (message: { category?: string; message: string }) => void;
  requestId: string;
}): Promise<boolean> {
  const messages: ChatMessage[] = [
    buildVerifyActCompletionSystemPrompt(),
    buildVerifyActCompletionUserPrompt(goal, steps, domElements),
  ];

  const response = await llmClient.createChatCompletion({
    messages,
    temperature: 0.1,
    top_p: 1,
    frequency_penalty: 0,
    presence_penalty: 0,
    image: screenshot
      ? {
          buffer: screenshot,
          description: "This is a screenshot of the whole visible page.",
        }
      : undefined,
    response_model: {
      name: "Verification",
      schema: z.object({
        completed: z.boolean().describe("true if the goal is accomplished"),
      }),
    },
    requestId,
  });

  if (!response || typeof response !== "object") {
    logger({
      category: "VerifyAct",
      message: "Unexpected response format: " + JSON.stringify(response),
    });
    return false;
  }

  if (response.completed === undefined) {
    logger({
      category: "VerifyAct",
      message: "Missing 'completed' field in response",
    });
    return false;
  }

  return response.completed;
}

export function fillInVariables(
  text: string,
  variables: Record<string, string>,
) {
  let processedText = text;
  Object.entries(variables).forEach(([key, value]) => {
    const placeholder = `<|${key.toUpperCase()}|>`;
    processedText = processedText.replace(placeholder, value);
  });
  return processedText;
}

export async function act({
  action,
  domElements,
  steps,
  llmProvider,
  llmClient,
  screenshot,
  retries = 0,
  logger,
  requestId,
  variables,
}: {
  action: string;
  steps?: string;
  domElements: string;
  llmProvider: LLMProvider;
  llmClient: LLMClient;
  screenshot?: Buffer;
  retries?: number;
  logger: (message: { category?: string; message: string }) => void;
  requestId: string;
  variables?: Record<string, string>;
}): Promise<{
  method: string;
  element: number;
  args: any[];
  completed: boolean;
  step: string;
  why?: string;
} | null> {
  const messages: ChatMessage[] = [
    buildActSystemPrompt(),
    buildActUserPrompt(action, steps, domElements, variables),
  ];

  const response = await llmClient.createChatCompletion({
    messages,
    temperature: 0.1,
    top_p: 1,
    frequency_penalty: 0,
    presence_penalty: 0,
    tool_choice: "auto" as const,
    tools: actTools,
    image: screenshot
      ? { buffer: screenshot, description: AnnotatedScreenshotText }
      : undefined,
    requestId,
  });

  const toolCalls = response.choices[0].message.tool_calls;

  if (toolCalls && toolCalls.length > 0) {
    if (toolCalls[0].function.name === "skipSection") {
      return null;
    }

    return JSON.parse(toolCalls[0].function.arguments);
  } else {
    if (retries >= 2) {
      logger({
        category: "Act",
        message: "No tool calls found in response",
      });
      return null;
    }

    return act({
      action,
      domElements,
      steps,
      llmProvider,
      llmClient,
      retries: retries + 1,
      logger,
      requestId,
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
  llmClient,
  chunksSeen,
  chunksTotal,
  requestId,
}: {
  instruction: string;
  progress: string;
  previouslyExtractedContent: any;
  domElements: string;
  schema: z.ZodObject<any>;
  llmProvider: LLMProvider;
  llmClient: LLMClient;
  chunksSeen: number;
  chunksTotal: number;
  requestId: string;
}) {
  const extractionResponse = await llmClient.createChatCompletion({
    messages: [
      buildExtractSystemPrompt(),
      buildExtractUserPrompt(instruction, domElements),
    ],
    response_model: {
      schema: schema,
      name: "Extraction",
    },
    temperature: 0.1,
    top_p: 1,
    frequency_penalty: 0,
    presence_penalty: 0,
    requestId,
  });

  const refinedResponse = await llmClient.createChatCompletion({
    messages: [
      buildRefineSystemPrompt(),
      buildRefineUserPrompt(
        instruction,
        previouslyExtractedContent,
        extractionResponse,
      ),
    ],
    response_model: {
      schema: schema,
      name: "RefinedExtraction",
    },
    temperature: 0.1,
    top_p: 1,
    frequency_penalty: 0,
    presence_penalty: 0,
    requestId,
  });

  const metadataSchema = z.object({
    progress: z
      .string()
      .describe(
        "progress of what has been extracted so far, as concise as possible",
      ),
    completed: z
      .boolean()
      .describe(
        "true if the goal is now accomplished. Use this conservatively, only when you are sure that the goal has been completed.",
      ),
  });

  const metadataResponse = await llmClient.createChatCompletion({
    messages: [
      buildMetadataSystemPrompt(),
      buildMetadataPrompt(
        instruction,
        refinedResponse,
        chunksSeen,
        chunksTotal,
      ),
    ],
    response_model: {
      name: "Metadata",
      schema: metadataSchema,
    },
    temperature: 0.1,
    top_p: 1,
    frequency_penalty: 0,
    presence_penalty: 0,
    requestId,
  });

  refinedResponse.metadata = metadataResponse;

  return refinedResponse;
}

export async function observe({
  instruction,
  domElements,
  llmProvider,
  llmClient,
  image,
  requestId,
}: {
  instruction: string;
  domElements: string;
  llmProvider: LLMProvider;
  llmClient: LLMClient;
  image?: Buffer;
  requestId: string;
}): Promise<{
  elements: { elementId: number; description: string }[];
}> {
  const observeSchema = z.object({
    elements: z
      .array(
        z.object({
          elementId: z.number().describe("the number of the element"),
          description: z
            .string()
            .describe(
              "a description of the element and what it is relevant for",
            ),
        }),
      )
      .describe("an array of elements that match the instruction"),
  });

  const observationResponse = await llmClient.createChatCompletion({
    messages: [
      buildObserveSystemPrompt(),
      buildObserveUserMessage(instruction, domElements),
    ],
    image: image
      ? { buffer: image, description: AnnotatedScreenshotText }
      : undefined,
    response_model: {
      schema: observeSchema,
      name: "Observation",
    },
    temperature: 0.1,
    top_p: 1,
    frequency_penalty: 0,
    presence_penalty: 0,
    requestId,
  });

  if (!observationResponse) {
    throw new Error("no response when finding a selector");
  }

  return observationResponse;
}

export async function ask({
  question,
  llmProvider,
  modelName,
  requestId,
}: {
  question: string;
  llmProvider: LLMProvider;
  modelName: AvailableModel;
  requestId: string;
}) {
  const llmClient = llmProvider.getClient(modelName);
  const response = await llmClient.createChatCompletion({
    messages: [buildAskSystemPrompt(), buildAskUserPrompt(question)],
    temperature: 0.1,
    top_p: 1,
    frequency_penalty: 0,
    presence_penalty: 0,
    requestId,
  });

  // The parsing is now handled in the LLM clients
  return response.choices[0].message.content;
}

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
import {
  AnnotatedScreenshotText,
  ChatMessage,
  LLMClient,
} from "./llm/LLMClient";
import { VerifyActCompletionParams } from "../types/inference";
import { ActResult, ActParams } from "../types/act";

export async function verifyActCompletion({
  goal,
  steps,
  llmClient,
  screenshot,
  domElements,
  logger,
  requestId,
}: VerifyActCompletionParams): Promise<boolean> {
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
  llmClient,
  screenshot,
  retries = 0,
  logger,
  requestId,
  variables,
}: ActParams): Promise<ActResult | null> {
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
  llmClient,
  image,
  requestId,
}: {
  instruction: string;
  domElements: string;
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
  llmClient,
  requestId,
}: {
  question: string;
  llmClient: LLMClient;
  requestId: string;
}) {
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

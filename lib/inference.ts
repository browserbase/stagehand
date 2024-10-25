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
import { AnnotatedScreenshotText, ChatMessage } from "./llm/LLMClient";

export async function verifyActCompletion({
  goal,
  steps,
  llmProvider,
  modelName,
  screenshot,
  domElements,
}: {
  goal: string;
  steps: string;
  llmProvider: LLMProvider;
  modelName: string;
  screenshot?: Buffer;
  domElements?: string;
}): Promise<boolean> {
  const llmClient = llmProvider.getClient(modelName);
  const messages = [
    buildVerifyActCompletionSystemPrompt() as ChatMessage,
    buildVerifyActCompletionUserPrompt(goal, steps, domElements) as ChatMessage,
  ];

  console.log(
    "[VerifyAct] messages",
    messages
      .map((m) => `\n\n${m.role}:\n--------------\n ${m.content}`)
      .join() + "\n\n\n",
  );

  const response = await llmClient.createChatCompletion({
    model: modelName,
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
  });

  if (!response || typeof response !== "object") {
    console.error("[VerifyAct] Unexpected response format:", response);
    return false;
  }

  console.log(
    "[VerifyAct] Action Completion Verification:",
    response.completed,
  );

  if (response.completed === undefined) {
    console.error('[VerifyAct] Missing "completed" field in response');
    return false;
  }

  return response.completed;
}

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
  chunksSeen,
  chunksTotal,
}: {
  instruction: string;
  progress: string;
  previouslyExtractedContent: any;
  domElements: string;
  schema: z.ZodObject<any>;
  llmProvider: LLMProvider;
  modelName: string;
  chunksSeen: number;
  chunksTotal: number;
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

  const refinedResponse = await llmClient.createExtraction({
    model: modelName,
    messages: [
      buildRefineSystemPrompt() as ChatMessage,
      buildRefineUserPrompt(
        instruction,
        previouslyExtractedContent,
        extractionResponse,
      ) as ChatMessage,
    ],
    response_model: {
      schema: schema,
      name: "RefinedExtraction",
    },
    temperature: 0.1,
    top_p: 1,
    frequency_penalty: 0,
    presence_penalty: 0,
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

  const metadataResponse = await llmClient.createExtraction({
    model: modelName,
    messages: [
      buildMetadataSystemPrompt() as ChatMessage,
      buildMetadataPrompt(
        instruction,
        refinedResponse,
        chunksSeen,
        chunksTotal,
      ) as ChatMessage,
    ],
    response_model: {
      name: "Metadata",
      schema: metadataSchema,
    },
    temperature: 0.1,
    top_p: 1,
    frequency_penalty: 0,
    presence_penalty: 0,
  });

  refinedResponse.metadata = metadataResponse;

  return refinedResponse;
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

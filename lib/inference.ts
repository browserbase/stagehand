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
import { LLMResponse } from "./llm/LLMClient";
import { LLMUsageEntry } from "../types/model";
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
  const verificationSchema = z.object({
    completed: z.boolean().describe("true if the goal is accomplished"),
  });

  type VerificationResponse = z.infer<typeof verificationSchema>;

  const response = await llmClient.createChatCompletion<
    VerificationResponse & { _stagehandTokenUsage?: LLMUsageEntry }
  >({
    messages: [
      buildVerifyActCompletionSystemPrompt(),
      buildVerifyActCompletionUserPrompt(goal, steps, domElements),
    ],
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
      schema: verificationSchema,
    },
    functionName: "verify_act",
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
}: ActParams): Promise<
  (ActResult & { _stagehandTokenUsage?: LLMUsageEntry }) | null
> {
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
    functionName: "act",
    requestId,
  });

  const toolCalls = response.choices[0].message.tool_calls;

  if (toolCalls && toolCalls.length > 0) {
    if (toolCalls[0].function.name === "skipSection") {
      return null;
    }

    const result = JSON.parse(toolCalls[0].function.arguments);
    const tokenUsage = response._stagehandTokenUsage;

    return {
      ...result,
      _stagehandTokenUsage: tokenUsage,
    };
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
  previouslyExtractedContent,
  domElements,
  schema,
  llmClient,
  chunksSeen,
  chunksTotal,
  requestId,
  isUsingTextExtract,
}: {
  instruction: string;
  previouslyExtractedContent: object;
  domElements: string;
  schema: z.ZodObject<z.ZodRawShape>;
  llmClient: LLMClient;
  chunksSeen: number;
  chunksTotal: number;
  requestId: string;
  isUsingTextExtract?: boolean;
}): Promise<{
  [key: string]: unknown;
  metadata?: { progress?: string; completed?: boolean };
  _stagehandTokenUsage?: LLMUsageEntry;
}> {
  type ExtractionResponse = z.infer<typeof schema>;
  type MetadataResponse = z.infer<typeof metadataSchema> & {
    _stagehandTokenUsage?: LLMUsageEntry;
  };
  const isUsingAnthropic = llmClient.type === "anthropic";

  const extractionResponse = await llmClient.createChatCompletion({
    messages: [
      buildExtractSystemPrompt(isUsingAnthropic, isUsingTextExtract),
      buildExtractUserPrompt(instruction, domElements, isUsingAnthropic),
    ],
    response_model: {
      schema: schema,
      name: "Extraction",
    },
    temperature: 0.1,
    top_p: 1,
    frequency_penalty: 0,
    presence_penalty: 0,
    functionName: "extract",
    requestId,
  });

  const refinedResponse =
    await llmClient.createChatCompletion<ExtractionResponse>({
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
      functionName: "refine_extract",
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

  const metadataResponse =
    await llmClient.createChatCompletion<MetadataResponse>({
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
      functionName: "metadata_extract",
      requestId,
    });

  // Get the token usage from the most recent extraction call
  const extractionTokenUsage = extractionResponse._stagehandTokenUsage;
  const refinedTokenUsage = refinedResponse._stagehandTokenUsage;
  const metadataTokenUsage = metadataResponse._stagehandTokenUsage;

  // Combine token usage from all calls
  const combinedTokenUsage = {
    functionName: "extract",
    modelName:
      extractionTokenUsage?.modelName ||
      refinedTokenUsage?.modelName ||
      metadataTokenUsage?.modelName,
    promptTokens:
      (extractionTokenUsage?.promptTokens || 0) +
      (refinedTokenUsage?.promptTokens || 0) +
      (metadataTokenUsage?.promptTokens || 0),
    completionTokens:
      (extractionTokenUsage?.completionTokens || 0) +
      (refinedTokenUsage?.completionTokens || 0) +
      (metadataTokenUsage?.completionTokens || 0),
    totalTokens:
      (extractionTokenUsage?.totalTokens || 0) +
      (refinedTokenUsage?.totalTokens || 0) +
      (metadataTokenUsage?.totalTokens || 0),
    timestamp: Date.now(),
  };

  return {
    ...refinedResponse,
    metadata: metadataResponse,
    _stagehandTokenUsage: combinedTokenUsage,
  };
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
  functionName?: string;
}): Promise<{
  elements: { elementId: number; description: string }[];
  _stagehandTokenUsage?: LLMUsageEntry;
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

  type ObserveResponse = z.infer<typeof observeSchema>;

  const observationResponse = await llmClient.createChatCompletion<
    ObserveResponse & { _stagehandTokenUsage?: LLMUsageEntry }
  >({
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
    functionName: "observe",
    requestId,
  });

  const parsedResponse = {
    elements:
      observationResponse.elements?.map((el) => ({
        elementId: Number(el.elementId),
        description: String(el.description),
      })) ?? [],
  } satisfies { elements: { elementId: number; description: string }[] };

  // Get the token usage from the observation response
  const tokenUsage = observationResponse._stagehandTokenUsage;

  return {
    ...parsedResponse,
    _stagehandTokenUsage: tokenUsage,
  };
}

export async function ask({
  question,
  llmClient,
  requestId,
}: {
  question: string;
  llmClient: LLMClient;
  requestId: string;
}): Promise<{
  content: string | null;
  _stagehandTokenUsage?: LLMUsageEntry;
}> {
  const response = await llmClient.createChatCompletion<LLMResponse>({
    messages: [buildAskSystemPrompt(), buildAskUserPrompt(question)],
    temperature: 0.1,
    top_p: 1,
    frequency_penalty: 0,
    presence_penalty: 0,
    functionName: "ask",
    requestId,
  });

  // The parsing is now handled in the LLM clients
  const content = response.choices[0].message.content;
  const tokenUsage = response._stagehandTokenUsage;

  return {
    content,
    _stagehandTokenUsage: tokenUsage,
  };
}

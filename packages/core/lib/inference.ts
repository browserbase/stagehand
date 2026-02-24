import { z } from "zod";
import { LogLine } from "./v3/types/public/logs.js";
import { ChatMessage, LLMClient } from "./v3/llm/LLMClient.js";
import { getEnvTimeoutMs, withTimeout } from "./v3/timeoutConfig.js";
import {
  buildActSystemPrompt,
  buildExtractSystemPrompt,
  buildExtractUserPrompt,
  buildMetadataPrompt,
  buildMetadataSystemPrompt,
  buildObserveSystemPrompt,
  buildObserveUserMessage,
} from "./prompt.js";
import { appendSummary, writeTimestampedTxtFile } from "./inferenceLogUtils.js";
import type {
  InferStagehandSchema,
  StagehandZodObject,
} from "./v3/zodCompat.js";
import { SupportedUnderstudyAction } from "./v3/types/private/handlers.js";

// Re-export for backward compatibility
export type { LLMParsedResponse, LLMUsage } from "./v3/llm/LLMClient.js";

function withLlmTimeout<T>(promise: Promise<T>, operation: string): Promise<T> {
  const timeoutMs = getEnvTimeoutMs("LLM_MAX_MS");
  if (!timeoutMs) return promise;
  return withTimeout(promise, timeoutMs, `LLM ${operation}`);
}

export async function extract<T extends StagehandZodObject>({
  instruction,
  domElements,
  schema,
  llmClient,
  logger,
  userProvidedInstructions,
  logInferenceToFile = false,
}: {
  instruction: string;
  domElements: string;
  schema: T;
  llmClient: LLMClient;
  userProvidedInstructions?: string;
  logger: (message: LogLine) => void;
  logInferenceToFile?: boolean;
}) {
  const metadataSchema = z.object({
    progress: z
      .string()
      .describe(
        "progress of what has been extracted so far, as concise as possible",
      ),
    completed: z
      .boolean()
      .describe(
        "true if the goal is now accomplished. Use this conservatively, only when sure that the goal has been completed.",
      ),
  });

  type ExtractionResponse = InferStagehandSchema<T>;
  type MetadataResponse = z.infer<typeof metadataSchema>;

  const isUsingAnthropic = llmClient.type === "anthropic";
  const isGPT5 = llmClient.modelName.includes("gpt-5"); // TODO: remove this as we update support for gpt-5 configuration options

  const extractCallMessages: ChatMessage[] = [
    buildExtractSystemPrompt(isUsingAnthropic, userProvidedInstructions),
    buildExtractUserPrompt(instruction, domElements, isUsingAnthropic),
  ];

  let extractCallFile = "";
  let extractCallTimestamp = "";
  if (logInferenceToFile) {
    const { fileName, timestamp } = writeTimestampedTxtFile(
      "extract_summary",
      "extract_call",
      {
        modelCall: "extract",
        messages: extractCallMessages,
      },
    );
    extractCallFile = fileName;
    extractCallTimestamp = timestamp;
  }

  const extractStartTime = Date.now();
  const extractionResponse = await withLlmTimeout(
    llmClient.createChatCompletion<ExtractionResponse>({
      options: {
        messages: extractCallMessages,
        response_model: {
          schema,
          name: "Extraction",
        },
        temperature: isGPT5 ? 1 : 0.1,
        top_p: 1,
        frequency_penalty: 0,
        presence_penalty: 0,
      },
      logger,
    }),
    "extract",
  );
  const extractEndTime = Date.now();

  const { data: extractedData, usage: extractUsage } = extractionResponse;

  let extractResponseFile: string;
  if (logInferenceToFile) {
    const { fileName } = writeTimestampedTxtFile(
      "extract_summary",
      "extract_response",
      {
        modelResponse: "extract",
        rawResponse: extractedData,
      },
    );
    extractResponseFile = fileName;

    appendSummary("extract", {
      extract_inference_type: "extract",
      timestamp: extractCallTimestamp,
      LLM_input_file: extractCallFile,
      LLM_output_file: extractResponseFile,
      prompt_tokens: extractUsage?.prompt_tokens ?? 0,
      completion_tokens: extractUsage?.completion_tokens ?? 0,
      reasoning_tokens: extractUsage?.reasoning_tokens ?? 0,
      cached_input_tokens: extractUsage?.cached_input_tokens ?? 0,
      inference_time_ms: extractEndTime - extractStartTime,
    });
  }

  const metadataCallMessages: ChatMessage[] = [
    buildMetadataSystemPrompt(),
    buildMetadataPrompt(instruction, extractedData),
  ];

  let metadataCallFile = "";
  let metadataCallTimestamp = "";
  if (logInferenceToFile) {
    const { fileName, timestamp } = writeTimestampedTxtFile(
      "extract_summary",
      "metadata_call",
      {
        modelCall: "metadata",
        messages: metadataCallMessages,
      },
    );
    metadataCallFile = fileName;
    metadataCallTimestamp = timestamp;
  }

  const metadataStartTime = Date.now();
  const metadataResponse = await withLlmTimeout(
    llmClient.createChatCompletion<MetadataResponse>({
      options: {
        messages: metadataCallMessages,
        response_model: {
          name: "Metadata",
          schema: metadataSchema,
        },
        temperature: isGPT5 ? 1 : 0.1,
        top_p: 1,
        frequency_penalty: 0,
        presence_penalty: 0,
      },
      logger,
    }),
    "extract metadata",
  );
  const metadataEndTime = Date.now();

  const {
    data: {
      completed: metadataResponseCompleted,
      progress: metadataResponseProgress,
    },
    usage: metadataResponseUsage,
  } = metadataResponse;

  let metadataResponseFile: string;
  if (logInferenceToFile) {
    const { fileName } = writeTimestampedTxtFile(
      "extract_summary",
      "metadata_response",
      {
        modelResponse: "metadata",
        completed: metadataResponseCompleted,
        progress: metadataResponseProgress,
      },
    );
    metadataResponseFile = fileName;

    appendSummary("extract", {
      extract_inference_type: "metadata",
      timestamp: metadataCallTimestamp,
      LLM_input_file: metadataCallFile,
      LLM_output_file: metadataResponseFile,
      prompt_tokens: metadataResponseUsage?.prompt_tokens ?? 0,
      completion_tokens: metadataResponseUsage?.completion_tokens ?? 0,
      reasoning_tokens: metadataResponseUsage?.reasoning_tokens ?? 0,
      cached_input_tokens: metadataResponseUsage?.cached_input_tokens ?? 0,
      inference_time_ms: metadataEndTime - metadataStartTime,
    });
  }

  const totalPromptTokens =
    (extractUsage?.prompt_tokens ?? 0) +
    (metadataResponseUsage?.prompt_tokens ?? 0);

  const totalCompletionTokens =
    (extractUsage?.completion_tokens ?? 0) +
    (metadataResponseUsage?.completion_tokens ?? 0);

  const totalInferenceTimeMs =
    extractEndTime - extractStartTime + (metadataEndTime - metadataStartTime);
  const totalReasoningTokens =
    (extractUsage?.reasoning_tokens ?? 0) +
    (metadataResponseUsage?.reasoning_tokens ?? 0);
  const totalCachedInputTokens =
    (extractUsage?.cached_input_tokens ?? 0) +
    (metadataResponseUsage?.cached_input_tokens ?? 0);

  return {
    ...extractedData,
    metadata: {
      completed: metadataResponseCompleted,
      progress: metadataResponseProgress,
    },
    prompt_tokens: totalPromptTokens,
    completion_tokens: totalCompletionTokens,
    reasoning_tokens: totalReasoningTokens,
    cached_input_tokens: totalCachedInputTokens,
    inference_time_ms: totalInferenceTimeMs,
  };
}

export async function observe({
  instruction,
  domElements,
  llmClient,
  userProvidedInstructions,
  logger,
  logInferenceToFile = false,
  supportedActions,
}: {
  instruction: string;
  domElements: string;
  llmClient: LLMClient;
  userProvidedInstructions?: string;
  logger: (message: LogLine) => void;
  logInferenceToFile?: boolean;
  supportedActions?: string[];
}) {
  const isGPT5 = llmClient.modelName.includes("gpt-5"); // TODO: remove this as we update support for gpt-5 configuration options

  const observeSchema = z.object({
    elements: z
      .array(
        z.object({
          elementId: z
            .string()
            .regex(/^\d+-\d+$/)
            .describe(
              "the ID string associated with the element. Never include surrounding square brackets. This field must follow the format of 'number-number'.",
            ),
          description: z
            .string()
            .describe(
              "a description of the accessible element and its purpose",
            ),
          method: z
            .enum(
              // Use Object.values() for Zod v3 compatibility - z.enum() in v3 doesn't accept TypeScript enums directly
              Object.values(SupportedUnderstudyAction) as unknown as readonly [
                string,
                ...string[],
              ],
            )
            .describe(
              `the candidate method/action to interact with the element. Select one of the available Understudy interaction methods.`,
            ),
          arguments: z.array(
            z
              .string()
              .describe(
                "the arguments to pass to the method. For example, for a click, the arguments are empty, but for a fill, the arguments are the value to fill in.",
              ),
          ),
        }),
      )
      .describe("an array of accessible elements that match the instruction"),
  });

  type ObserveResponse = z.infer<typeof observeSchema>;

  const messages: ChatMessage[] = [
    buildObserveSystemPrompt(userProvidedInstructions, supportedActions),
    buildObserveUserMessage(instruction, domElements),
  ];

  let callTimestamp = "";
  let callFile = "";
  if (logInferenceToFile) {
    const { fileName, timestamp } = writeTimestampedTxtFile(
      `observe_summary`,
      `observe_call`,
      {
        modelCall: "observe",
        messages,
      },
    );
    callFile = fileName;
    callTimestamp = timestamp;
  }

  const start = Date.now();
  const rawResponse = await llmClient.createChatCompletion<ObserveResponse>({
    options: {
      messages,
      response_model: {
        schema: observeSchema,
        name: "Observation",
      },
      temperature: isGPT5 ? 1 : 0.1,
      top_p: 1,
      frequency_penalty: 0,
      presence_penalty: 0,
    },
    logger,
  });
  const end = Date.now();
  const usageTimeMs = end - start;

  const { data: observeData, usage: observeUsage } = rawResponse;
  const promptTokens = observeUsage?.prompt_tokens ?? 0;
  const completionTokens = observeUsage?.completion_tokens ?? 0;
  const reasoningTokens = observeUsage?.reasoning_tokens ?? 0;
  const cachedInputTokens = observeUsage?.cached_input_tokens ?? 0;

  let responseFile: string;
  if (logInferenceToFile) {
    const { fileName: responseFileName } = writeTimestampedTxtFile(
      `observe_summary`,
      `observe_response`,
      {
        modelResponse: "observe",
        rawResponse: observeData,
      },
    );
    responseFile = responseFileName;

    appendSummary("observe", {
      [`observe_inference_type`]: "observe",
      timestamp: callTimestamp,
      LLM_input_file: callFile,
      LLM_output_file: responseFile,
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      reasoning_tokens: reasoningTokens,
      cached_input_tokens: cachedInputTokens,
      inference_time_ms: usageTimeMs,
    });
  }

  const parsedElements =
    observeData.elements?.map((el) => {
      const base = {
        elementId: el.elementId,
        description: String(el.description),
        method: String(el.method),
        arguments: el.arguments,
      };
      return base;
    }) ?? [];

  return {
    elements: parsedElements,
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    reasoning_tokens: reasoningTokens,
    cached_input_tokens: cachedInputTokens,
    inference_time_ms: usageTimeMs,
  };
}

export async function act({
  instruction,
  domElements,
  llmClient,
  userProvidedInstructions,
  logger,
  logInferenceToFile = false,
}: {
  instruction: string;
  domElements: string;
  llmClient: LLMClient;
  userProvidedInstructions?: string;
  logger: (message: LogLine) => void;
  logInferenceToFile?: boolean;
}) {
  const isGPT5 = llmClient.modelName.includes("gpt-5"); // TODO: remove this as we update support for gpt-5 configuration options

  const actSchema = z.object({
    elementId: z
      .string()
      .regex(/^\d+-\d+$/)
      .describe(
        "the ID string associated with the element. Never include surrounding square brackets. This field must follow the format of 'number-number'.",
      ),
    description: z
      .string()
      .describe("a description of the accessible element and its purpose"),
    method: z
      .enum(
        // Use Object.values() for Zod v3 compatibility - z.enum() in v3 doesn't accept TypeScript enums directly
        Object.values(SupportedUnderstudyAction) as unknown as readonly [
          string,
          ...string[],
        ],
      )
      .describe(
        "the candidate method/action to interact with the element. Select one of the available Understudy interaction methods.",
      ),
    arguments: z.array(
      z
        .string()
        .describe(
          "the arguments to pass to the method. For example, for a click, the arguments are empty, but for a fill, the arguments are the value to fill in.",
        ),
    ),
    twoStep: z.boolean(),
  });

  type ActResponse = z.infer<typeof actSchema>;

  const messages: ChatMessage[] = [
    buildActSystemPrompt(userProvidedInstructions),
    buildObserveUserMessage(instruction, domElements),
  ];

  let callTimestamp = "";
  let callFile = "";
  if (logInferenceToFile) {
    const { fileName, timestamp } = writeTimestampedTxtFile(
      `act_summary`,
      `act_call`,
      {
        modelCall: "act",
        messages,
      },
    );
    callFile = fileName;
    callTimestamp = timestamp;
  }

  const start = Date.now();
  const rawResponse = await llmClient.createChatCompletion<ActResponse>({
    options: {
      messages,
      response_model: {
        schema: actSchema,
        name: "act",
      },
      temperature: isGPT5 ? 1 : 0.1,
      top_p: 1,
      frequency_penalty: 0,
      presence_penalty: 0,
    },
    logger,
  });
  const end = Date.now();
  const usageTimeMs = end - start;

  const { data: actData, usage: actUsage } = rawResponse;
  const promptTokens = actUsage?.prompt_tokens ?? 0;
  const completionTokens = actUsage?.completion_tokens ?? 0;
  const reasoningTokens = actUsage?.reasoning_tokens ?? 0;
  const cachedInputTokens = actUsage?.cached_input_tokens ?? 0;

  let responseFile: string;
  if (logInferenceToFile) {
    const { fileName: responseFileName } = writeTimestampedTxtFile(
      `act_summary`,
      `act_response`,
      {
        modelResponse: "act",
        rawResponse: actData,
      },
    );
    responseFile = responseFileName;

    appendSummary("act", {
      [`act_inference_type`]: "act",
      timestamp: callTimestamp,
      LLM_input_file: callFile,
      LLM_output_file: responseFile,
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      reasoning_tokens: reasoningTokens,
      cached_input_tokens: cachedInputTokens,
      inference_time_ms: usageTimeMs,
    });
  }

  const parsedElement = {
    elementId: actData.elementId,
    description: String(actData.description),
    method: String(actData.method),
    arguments: actData.arguments,
  };

  return {
    element: parsedElement,
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    reasoning_tokens: reasoningTokens,
    cached_input_tokens: cachedInputTokens,
    inference_time_ms: usageTimeMs,
    twoStep: actData.twoStep,
  };
}

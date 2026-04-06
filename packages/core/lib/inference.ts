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
import {
  ElementRef,
  ModelAction,
  ModelActResponse,
  modelActionSchema,
  modelActResponseSchema,
} from "./v3/types/private/modelActions.js";
import type { EncodedId } from "./v3/types/private/internal.js";
import type { Variables } from "./v3/types/public/agent.js";

// Re-export for backward compatibility
export type { LLMParsedResponse, LLMUsage } from "./v3/llm/LLMClient.js";

function withLlmTimeout<T>(promise: Promise<T>, operation: string): Promise<T> {
  return withTimeout(
    promise,
    getEnvTimeoutMs("LLM_MAX_MS"),
    `LLM ${operation}`,
  );
}

type LegacyInferenceAction = {
  elementId: EncodedId;
  description: string;
  method: ModelAction["method"];
  arguments: string[];
};

function encodeElementRef(ref: ElementRef): EncodedId {
  return `${ref.frameOrdinal}-${ref.backendNodeId}`;
}

function toLegacyInferenceAction(action: ModelAction): LegacyInferenceAction {
  switch (action.method) {
    case "click":
      return {
        elementId: encodeElementRef(action.target),
        description: action.description,
        method: action.method,
        arguments: action.button ? [action.button] : [],
      };
    case "fill":
      return {
        elementId: encodeElementRef(action.target),
        description: action.description,
        method: action.method,
        arguments: [action.value],
      };
    case "type":
      return {
        elementId: encodeElementRef(action.target),
        description: action.description,
        method: action.method,
        arguments: [action.text],
      };
    case "press":
      return {
        elementId: encodeElementRef(action.target),
        description: action.description,
        method: action.method,
        arguments: [action.key],
      };
    case "scrollTo":
      return {
        elementId: encodeElementRef(action.target),
        description: action.description,
        method: action.method,
        arguments: [action.position],
      };
    case "selectOptionFromDropdown":
      return {
        elementId: encodeElementRef(action.target),
        description: action.description,
        method: action.method,
        arguments: [action.option],
      };
    case "dragAndDrop":
      return {
        elementId: encodeElementRef(action.target),
        description: action.description,
        method: action.method,
        arguments: [encodeElementRef(action.destination)],
      };
    case "doubleClick":
    case "hover":
    case "nextChunk":
    case "prevChunk":
      return {
        elementId: encodeElementRef(action.target),
        description: action.description,
        method: action.method,
        arguments: [],
      };
  }
}

export async function extract<T extends StagehandZodObject>({
  instruction,
  domElements,
  schema,
  strictSchema = true,
  llmClient,
  logger,
  userProvidedInstructions,
  logInferenceToFile = false,
}: {
  instruction: string;
  domElements: string;
  schema: T;
  strictSchema?: boolean;
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
          strict: strictSchema,
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
  variables,
}: {
  instruction: string;
  domElements: string;
  llmClient: LLMClient;
  userProvidedInstructions?: string;
  logger: (message: LogLine) => void;
  logInferenceToFile?: boolean;
  supportedActions?: string[];
  variables?: Variables;
}) {
  const isGPT5 = llmClient.modelName.includes("gpt-5"); // TODO: remove this as we update support for gpt-5 configuration options

  const observeSchema = z.object({
    elements: z
      .array(modelActionSchema)
      .describe("an array of accessible elements that match the instruction"),
  });

  type ObserveResponse = z.infer<typeof observeSchema>;

  const messages: ChatMessage[] = [
    buildObserveSystemPrompt(
      userProvidedInstructions,
      supportedActions,
      variables,
    ),
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
      return toLegacyInferenceAction(el);
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

  const actSchema = modelActResponseSchema;

  type ActResponse = ModelActResponse;

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

  const parsedElement = toLegacyInferenceAction(actData.action);

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

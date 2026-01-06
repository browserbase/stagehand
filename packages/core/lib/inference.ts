import { z } from "zod";
import { LogLine } from "./v3/types/public/logs";
import { ChatMessage, LLMClient } from "./v3/llm/LLMClient";
import {
  buildActSystemPrompt,
  buildExtractSystemPrompt,
  buildExtractUserPrompt,
  buildMetadataPrompt,
  buildMetadataSystemPrompt,
  buildObserveSystemPrompt,
  buildObserveUserMessage,
  buildScrapeSystemPrompt,
  buildScrapeUserPrompt,
  buildScrapeRegexSystemPrompt,
  buildScrapeRegexUserPrompt,
} from "./prompt";
import { appendSummary, writeTimestampedTxtFile } from "./inferenceLogUtils";
import type { InferStagehandSchema, StagehandZodObject } from "./v3/zodCompat";

// Re-export for backward compatibility
export type { LLMParsedResponse, LLMUsage } from "./v3/llm/LLMClient";

async function runExtraction<T extends StagehandZodObject>({
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
  const extractionResponse =
    await llmClient.createChatCompletion<ExtractionResponse>({
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
    });
  const extractEndTime = Date.now();

  const { data: extractedData, usage: extractUsage } = extractionResponse;

  let extractResponseFile = "";
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
  const metadataResponse =
    await llmClient.createChatCompletion<MetadataResponse>({
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
    });
  const metadataEndTime = Date.now();

  const {
    data: {
      completed: metadataResponseCompleted,
      progress: metadataResponseProgress,
    },
    usage: metadataResponseUsage,
  } = metadataResponse;

  let metadataResponseFile = "";
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

export async function extract<T extends StagehandZodObject>(params: {
  instruction: string;
  domElements: string;
  schema: T;
  llmClient: LLMClient;
  userProvidedInstructions?: string;
  logger: (message: LogLine) => void;
  logInferenceToFile?: boolean;
}) {
  return runExtraction(params);
}

export async function scrape<T extends StagehandZodObject>({
  instruction,
  domElements,
  schema,
  llmClient,
  userProvidedInstructions,
  logger,
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
  const isGPT5 = llmClient.modelName.includes("gpt-5");

  const scrapeCallMessages: ChatMessage[] = [
    buildScrapeSystemPrompt(isUsingAnthropic, userProvidedInstructions),
    buildScrapeUserPrompt(instruction, domElements, isUsingAnthropic),
  ];

  let scrapeCallFile = "";
  let scrapeCallTimestamp = "";
  if (logInferenceToFile) {
    const { fileName, timestamp } = writeTimestampedTxtFile(
      "scrape_summary",
      "scrape_call",
      {
        modelCall: "scrape",
        messages: scrapeCallMessages,
      },
    );
    scrapeCallFile = fileName;
    scrapeCallTimestamp = timestamp;
  }

  const scrapeStartTime = Date.now();
  const scrapeResponse =
    await llmClient.createChatCompletion<ExtractionResponse>({
      options: {
        messages: scrapeCallMessages,
        response_model: {
          schema,
          name: "Scrape",
        },
        temperature: isGPT5 ? 1 : 0.1,
        top_p: 1,
        frequency_penalty: 0,
        presence_penalty: 0,
      },
      logger,
    });
  const scrapeEndTime = Date.now();

  const { data: scrapedData, usage: scrapeUsage } = scrapeResponse;

  let scrapeResponseFile = "";
  if (logInferenceToFile) {
    const { fileName } = writeTimestampedTxtFile(
      "scrape_summary",
      "scrape_response",
      {
        modelResponse: "scrape",
        rawResponse: scrapedData,
      },
    );
    scrapeResponseFile = fileName;

    appendSummary("scrape", {
      scrape_inference_type: "scrape",
      timestamp: scrapeCallTimestamp,
      LLM_input_file: scrapeCallFile,
      LLM_output_file: scrapeResponseFile,
      prompt_tokens: scrapeUsage?.prompt_tokens ?? 0,
      completion_tokens: scrapeUsage?.completion_tokens ?? 0,
      reasoning_tokens: scrapeUsage?.reasoning_tokens ?? 0,
      cached_input_tokens: scrapeUsage?.cached_input_tokens ?? 0,
      inference_time_ms: scrapeEndTime - scrapeStartTime,
    });
  }

  const metadataCallMessages: ChatMessage[] = [
    buildMetadataSystemPrompt(),
    buildMetadataPrompt(instruction, scrapedData),
  ];

  let metadataCallFile = "";
  let metadataCallTimestamp = "";
  if (logInferenceToFile) {
    const { fileName, timestamp } = writeTimestampedTxtFile(
      "scrape_summary",
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
  const metadataResponse =
    await llmClient.createChatCompletion<MetadataResponse>({
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
    });
  const metadataEndTime = Date.now();

  const {
    data: {
      completed: metadataResponseCompleted,
      progress: metadataResponseProgress,
    },
    usage: metadataResponseUsage,
  } = metadataResponse;

  let metadataResponseFile = "";
  if (logInferenceToFile) {
    const { fileName } = writeTimestampedTxtFile(
      "scrape_summary",
      "metadata_response",
      {
        modelResponse: "metadata",
        completed: metadataResponseCompleted,
        progress: metadataResponseProgress,
      },
    );
    metadataResponseFile = fileName;

    appendSummary("scrape", {
      scrape_inference_type: "metadata",
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
    (scrapeUsage?.prompt_tokens ?? 0) +
    (metadataResponseUsage?.prompt_tokens ?? 0);

  const totalCompletionTokens =
    (scrapeUsage?.completion_tokens ?? 0) +
    (metadataResponseUsage?.completion_tokens ?? 0);

  const totalInferenceTimeMs =
    scrapeEndTime - scrapeStartTime + (metadataEndTime - metadataStartTime);
  const totalReasoningTokens =
    (scrapeUsage?.reasoning_tokens ?? 0) +
    (metadataResponseUsage?.reasoning_tokens ?? 0);
  const totalCachedInputTokens =
    (scrapeUsage?.cached_input_tokens ?? 0) +
    (metadataResponseUsage?.cached_input_tokens ?? 0);

  return {
    ...scrapedData,
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
}: {
  instruction: string;
  domElements: string;
  llmClient: LLMClient;
  userProvidedInstructions?: string;
  logger: (message: LogLine) => void;
  logInferenceToFile?: boolean;
}) {
  const isGPT5 = llmClient.modelName.includes("gpt-5"); // TODO: remove this as we update support for gpt-5 configuration options

  const observeSchema = z.object({
    elements: z
      .array(
        z.object({
          elementId: z
            .string()
            .describe(
              "the ID string associated with the element. Never include surrounding square brackets. This field must follow the format of 'number-number'.",
            ),
          description: z
            .string()
            .describe(
              "a description of the accessible element and its purpose",
            ),
          method: z
            .string()
            .describe(
              "the candidate method/action to interact with the element. Select one of the available Playwright interaction methods.",
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
    buildObserveSystemPrompt(userProvidedInstructions),
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

  let responseFile = "";
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
      .describe(
        "the ID string associated with the element. Never include surrounding square brackets. This field must follow the format of 'number-number'.",
      ),
    description: z
      .string()
      .describe("a description of the accessible element and its purpose"),
    method: z
      .string()
      .describe(
        "the candidate method/action to interact with the element. Select one of the available Playwright interaction methods.",
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

  let responseFile = "";
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
const MAX_REGEX_PATTERN_LENGTH = 128;
const FORBIDDEN_REGEX_SEGMENTS = [
  /\(\?/, // disallow lookarounds and special group syntax
  /\\[pPxXuUkKgGqQcC]/, // disallow unicode classes, backreferences, control sequences
  /\\0[0-9]/, // disallow octal references
  /\\N\{/,
];

function isAllowedRegexPattern(pattern: string): boolean {
  if (pattern.length === 0 || pattern.length > MAX_REGEX_PATTERN_LENGTH) {
    return false;
  }
  if (pattern.includes("\n") || pattern.includes("\r")) {
    return false;
  }
  for (const fragment of FORBIDDEN_REGEX_SEGMENTS) {
    if (fragment.test(pattern)) {
      return false;
    }
  }
  try {
    // Ensure JavaScript can compile the regex.
    new RegExp(pattern);
  } catch {
    return false;
  }
  return true;
}

const allowedRegexSchema = z.object({
  rules: z
    .array(
      z.object({
        path: z.string(),
        regex: z.string().refine(isAllowedRegexPattern, {
          message:
            "Regex must be <= 128 chars, single-line, and avoid advanced tokens like lookarounds or unicode escapes.",
        }),
        replacement: z.string().default(""),
        flags: z.literal("g").default("g"),
      }),
    )
    .min(1),
});

export async function generateScrapeRegex({
  schema,
  sample,
  error,
  llmClient,
  logger,
}: {
  schema: string;
  sample: string;
  error: string;
  llmClient: LLMClient;
  logger: (message: LogLine) => void;
}): Promise<z.infer<typeof allowedRegexSchema> | null> {
  const messages: ChatMessage[] = [
    buildScrapeRegexSystemPrompt(),
    buildScrapeRegexUserPrompt({ schema, sample, error }),
  ];

  const response = await llmClient.createChatCompletion<
    z.infer<typeof allowedRegexSchema>
  >({
    options: {
      messages,
      response_model: {
        schema: allowedRegexSchema,
        name: "ScrapeRegex",
      },
      temperature: 0,
      top_p: 1,
    },
    logger,
  });

  if (!response.data) {
    return null;
  }

  const parsed = allowedRegexSchema.parse(response.data);
  return parsed;
}

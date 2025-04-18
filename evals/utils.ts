/**
 * This file provides utility functions and classes to assist with evaluation tasks.
 *
 * Key functionalities:
 * - String normalization and fuzzy comparison utility functions to compare output strings
 *   against expected results in a flexible and robust way.
 * - Generation of unique experiment names based on the current timestamp, environment,
 *   and eval name or category.
 */

import { LogLine } from "@/dist";
import stringComparison from "string-comparison";
const { jaroWinkler } = stringComparison;
import OpenAI from "openai";
import { wrapAISDKModel, wrapOpenAI } from "braintrust";
import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";
import { groq } from "@ai-sdk/groq";
import { cerebras } from "@ai-sdk/cerebras";
import { LLMClient } from "@/dist";
import { AISdkClient } from "@/examples/external_clients/aisdk";
import { CustomOpenAIClient } from "@/examples/external_clients/customOpenAI";
import { OpenAIClient } from "@/lib/llm/OpenAIClient";
import { AnthropicClient } from "@/lib/llm/AnthropicClient";
import { GoogleClient } from "@/lib/llm/GoogleClient";
import { CreateLLMClientOptions } from "@/types/evals";
import { StagehandEvalError } from "@/types/stagehandErrors";

/**
 * normalizeString:
 * Prepares a string for comparison by:
 * - Converting to lowercase
 * - Collapsing multiple spaces to a single space
 * - Removing punctuation and special characters that are not alphabetic or numeric
 * - Normalizing spacing around commas
 * - Trimming leading and trailing whitespace
 *
 * This helps create a stable string representation to compare against expected outputs,
 * even if the actual output contains minor formatting differences.
 */
export function normalizeString(str: string): string {
  return str
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[;/#!$%^&*:{}=\-_`~()]/g, "")
    .replace(/\s*,\s*/g, ", ")
    .trim();
}

/**
 * compareStrings:
 * Compares two strings (actual vs. expected) using a similarity metric (Jaro-Winkler).
 *
 * Arguments:
 * - actual: The actual output string to be checked.
 * - expected: The expected string we want to match against.
 * - similarityThreshold: A number between 0 and 1. Default is 0.85.
 *   If the computed similarity is greater than or equal to this threshold,
 *   we consider the strings sufficiently similar.
 *
 * Returns:
 * - similarity: A number indicating how similar the two strings are.
 * - meetsThreshold: A boolean indicating if the similarity meets or exceeds the threshold.
 *
 * This function is useful for tasks where exact string matching is too strict,
 * allowing for fuzzy matching that tolerates minor differences in formatting or spelling.
 */
export function compareStrings(
  actual: string,
  expected: string,
  similarityThreshold: number = 0.85,
): { similarity: number; meetsThreshold: boolean } {
  const similarity = jaroWinkler.similarity(
    normalizeString(actual),
    normalizeString(expected),
  );
  return {
    similarity,
    meetsThreshold: similarity >= similarityThreshold,
  };
}

/**
 * generateTimestamp:
 * Generates a timestamp string formatted as "YYYYMMDDHHMMSS".
 * Used to create unique experiment names, ensuring that results can be
 * distinguished by the time they were generated.
 */
export function generateTimestamp(): string {
  const now = new Date();
  return now
    .toISOString()
    .replace(/[-:TZ]/g, "")
    .slice(0, 14);
}

/**
 * generateExperimentName:
 * Creates a unique name for the experiment based on optional evalName or category,
 * the environment (e.g., dev or CI), and the current timestamp.
 * This is used to label the output files and directories.
 */
export function generateExperimentName({
  evalName,
  category,
  environment,
}: {
  evalName?: string;
  category?: string;
  environment: string;
}): string {
  const timestamp = generateTimestamp();
  if (evalName) {
    return `${evalName}_${environment.toLowerCase()}_${timestamp}`;
  }
  if (category) {
    return `${category}_${environment.toLowerCase()}_${timestamp}`;
  }
  return `all_${environment.toLowerCase()}_${timestamp}`;
}

export function logLineToString(logLine: LogLine): string {
  try {
    const timestamp = logLine.timestamp || new Date().toISOString();
    if (logLine.auxiliary?.error) {
      return `${timestamp}::[stagehand:${logLine.category}] ${logLine.message}\n ${logLine.auxiliary.error.value}\n ${logLine.auxiliary.trace.value}`;
    }
    return `${timestamp}::[stagehand:${logLine.category}] ${logLine.message} ${
      logLine.auxiliary ? JSON.stringify(logLine.auxiliary) : ""
    }`;
  } catch (error) {
    console.error(`Error logging line:`, error);
    return "error logging line";
  }
}

export function createLLMClient({
  modelName,
  useExternalClients,
  logger,
  openAiKey,
  googleKey,
  anthropicKey,
  togetherKey,
}: CreateLLMClientOptions): LLMClient {
  const isOpenAIModel = modelName.startsWith("gpt");
  const isGoogleModel = modelName.startsWith("gemini");
  const isAnthropicModel = modelName.startsWith("claude");
  const isGroqModel = modelName.includes("groq");
  const isCerebrasModel = modelName.includes("cerebras");

  if (useExternalClients) {
    if (isOpenAIModel) {
      if (modelName.includes("/")) {
        return new CustomOpenAIClient({
          modelName,
          client: wrapOpenAI(
            new OpenAI({
              apiKey: togetherKey,
              baseURL: "https://api.together.xyz/v1",
            }),
          ),
        });
      }
      return new CustomOpenAIClient({
        modelName,
        client: wrapOpenAI(
          new OpenAI({
            apiKey: openAiKey,
          }),
        ),
      });
    } else if (isGoogleModel) {
      return new AISdkClient({
        model: wrapAISDKModel(google(modelName)),
      });
    } else if (isAnthropicModel) {
      return new AISdkClient({
        model: wrapAISDKModel(anthropic(modelName)),
      });
    } else if (isGroqModel) {
      const groqModel = modelName.substring(modelName.indexOf("/") + 1);
      return new AISdkClient({
        model: wrapAISDKModel(groq(groqModel)),
      });
    } else if (isCerebrasModel) {
      const cerebrasModel = modelName.substring(modelName.indexOf("/") + 1);
      return new AISdkClient({
        model: wrapAISDKModel(cerebras(cerebrasModel)),
      });
    }
    throw new StagehandEvalError(`Unknown modelName: ${modelName}`);
  } else {
    if (isOpenAIModel) {
      if (modelName.includes("/")) {
        return new CustomOpenAIClient({
          modelName,
          client: wrapOpenAI(
            new OpenAI({
              apiKey: togetherKey,
              baseURL: "https://api.together.xyz/v1",
            }),
          ),
        });
      }
      return new OpenAIClient({
        logger,
        modelName,
        enableCaching: false,
        clientOptions: {
          apiKey: openAiKey,
        },
      });
    } else if (isGoogleModel) {
      return new GoogleClient({
        logger,
        modelName,
        enableCaching: false,
        clientOptions: {
          apiKey: googleKey,
        },
      });
    } else if (isAnthropicModel) {
      return new AnthropicClient({
        logger,
        modelName,
        enableCaching: false,
        clientOptions: {
          apiKey: anthropicKey,
        },
      });
    } else if (isGroqModel || isCerebrasModel) {
      throw new StagehandEvalError(
        `${modelName} can only be used when useExternalClients=true`,
      );
    }
    throw new StagehandEvalError(`Unknown modelName: ${modelName}`);
  }
}

// Compile-only shim: copied handlers depend on these V3 inference entry points.
// Replace this file with the real V3 inference implementation in a dedicated port slice.
import type { z } from "zod/v4";
import type { LogLine } from "./types/public/logs.js";
import type { LLMClient } from "./llm/LLMClient.js";

type LlmInferenceParams = {
  instruction: string;
  domElements: string;
  llmClient: LLMClient;
  userProvidedInstructions?: string;
  logger: (message: LogLine) => void;
  logInferenceToFile?: boolean;
};

function inferenceNotPorted(operation: string): never {
  throw new Error(
    `${operation} inference is not ported yet. This compile stub will be replaced by the V3 inference implementation.`,
  );
}

export async function extract<T extends z.ZodObject>(
  _params: LlmInferenceParams & {
    schema: T;
    screenshot?: Buffer;
  },
): Promise<
  z.infer<T> & {
    metadata: { completed: boolean };
    prompt_tokens: number;
    completion_tokens: number;
    reasoning_tokens: number;
    cached_input_tokens?: number;
    inference_time_ms: number;
  }
> {
  return inferenceNotPorted("extract");
}

export async function observe(
  _params: LlmInferenceParams & {
    supportedActions?: string[];
    variables?: Record<string, unknown>;
  },
): Promise<{
  elements: Array<{
    elementId?: string;
    description: string;
    method?: string;
    arguments?: string[];
  }>;
  prompt_tokens?: number;
  completion_tokens?: number;
  reasoning_tokens?: number;
  cached_input_tokens?: number;
  inference_time_ms?: number;
}> {
  return inferenceNotPorted("observe");
}

export async function act(_params: LlmInferenceParams): Promise<{
  element?: {
    elementId?: string;
    description: string;
    method?: string;
    arguments?: string[];
  } | null;
  twoStep?: boolean;
  prompt_tokens?: number;
  completion_tokens?: number;
  reasoning_tokens?: number;
  cached_input_tokens?: number;
  inference_time_ms?: number;
}> {
  return inferenceNotPorted("act");
}

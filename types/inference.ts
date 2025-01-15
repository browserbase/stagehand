import { Buffer } from "buffer";
import { LLMClient } from "../lib/llm/LLMClient";
import { LLMProvider } from "../lib/llm/LLMProvider";

export interface VerifyActCompletionParams {
  goal: string;
  steps: string;
  llmProvider: LLMProvider;
  llmClient: LLMClient;
  screenshot?: Buffer;
  domElements?: string;
  logger: (message: { category?: string; message: string }) => void;
  requestId: string;
}

export interface VerifyActCompletionResult {
  completed: boolean;
  why: string;
}

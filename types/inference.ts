import { Buffer } from "buffer";
import { LLMClient } from "../lib/llm/LLMClient";
import { LLMProvider } from "../lib/llm/LLMProvider";
import { LogLine } from "./log";

export interface VerifyActCompletionParams {
  goal: string;
  steps: string;
  llmProvider: LLMProvider;
  llmClient: LLMClient;
  screenshot?: Buffer;
  domElements?: string;
  logger: (message: LogLine) => void;
  requestId: string;
}

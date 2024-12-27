import { Buffer } from "buffer";
import { LLMClient } from "../lib/llm/LLMClient";
import { TokenUsageResult } from "./tokenUsage";

export interface ActParams {
  action: string;
  steps?: string;
  domElements: string;
  llmClient: LLMClient;
  screenshot?: Buffer;
  retries?: number;
  logger: (message: { category?: string; message: string }) => void;
  requestId: string;
  variables?: Record<string, string>;
}

export interface ActResult extends TokenUsageResult {
  method: string;
  element: number;
  args: unknown[];
  completed: boolean;
  step: string;
  why?: string;
  success?: boolean;
  message?: string;
  action?: string;
}

import { Buffer } from "buffer";
import { LLMClient } from "../lib/llm/LLMClient";

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

import { WithTokenUsage } from "./tokenUsage";

export interface ActResult extends WithTokenUsage {
  method: string;
  element: number;
  args: unknown[];
  completed: boolean;
  step: string;
  why?: string;
}

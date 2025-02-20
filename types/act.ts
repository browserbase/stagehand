import { LLMClient } from "../lib/llm/LLMClient";

// WARNING: This is NOT to be confused with the ActParams type used in `page.act()`.
// This is the type for the parameters passed to the `act` command in `inference.ts`.
// page.act() params/result types are defined in `types/stagehand.ts`.
export interface ActCommandParams {
  action: string;
  steps?: string;
  domElements: string;
  llmClient: LLMClient;
  retries?: number;
  logger: (message: { category?: string; message: string }) => void;
  requestId: string;
  variables?: Record<string, string>;
  userProvidedInstructions?: string;
}

// WARNING: This is NOT to be confused with the ActResult type used in `page.act()`.
// This is the type for the result of the `act` command in `inference.ts`.
// page.act() params/result types are defined in `types/stagehand.ts`.
export interface ActCommandResult {
  method: string;
  element: number;
  args: unknown[];
  completed: boolean;
  step: string;
  why?: string;
  commentary?: string;
  findings?: string;
}

export interface ActCompletedResult {
  result: string;
  completed: boolean;
  commentary?: string;
}

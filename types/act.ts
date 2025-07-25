import { LLMClient } from "../lib/llm/LLMClient";
import { Locator } from "playwright";
import { Logger } from "@/types/log";
import { StagehandPage } from "@/lib/StagehandPage";

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
}

// We can use this enum to list the actions supported in performPlaywrightMethod
export enum SupportedPlaywrightAction {
  CLICK = "click",
  FILL = "fill",
  TYPE = "type",
  PRESS = "press",
  SCROLL = "scrollTo",
  NEXT_CHUNK = "nextChunk",
  PREV_CHUNK = "prevChunk",
  SELECT_OPTION_FROM_DROPDOWN = "selectOptionFromDropdown",
}

/**
 * A context object to hold all parameters that might be needed by
 * any of the methods in the `methodHandlerMap`
 */
export interface MethodHandlerContext {
  method: string;
  locator: Locator;
  xpath: string;
  args: unknown[];
  logger: Logger;
  stagehandPage: StagehandPage;
  initialUrl: string;
  domSettleTimeoutMs?: number;
}

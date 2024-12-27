import Browserbase from "@browserbasehq/sdk";
import { BrowserContext, Page } from "@playwright/test";
import { z } from "zod";
import { LLMProvider } from "../lib/llm/LLMProvider";
import { LogLine } from "./log";
import { AvailableModel, ClientOptions } from "./model";

export interface ConstructorParams {
  env: "LOCAL" | "BROWSERBASE";
  apiKey?: string;
  projectId?: string;
  verbose?: 0 | 1 | 2;
  debugDom?: boolean;
  llmProvider?: LLMProvider;
  headless?: boolean;
  logger?: (message: LogLine) => void;
  domSettleTimeoutMs?: number;
  browserbaseSessionCreateParams?: Browserbase.Sessions.SessionCreateParams;
  enableCaching?: boolean;
  browserbaseSessionID?: string;
  modelName?: AvailableModel;
  modelClientOptions?: ClientOptions;
}

export interface InitOptions {
  /** @deprecated Pass this into the Stagehand constructor instead. This will be removed in the next major version. */
  modelName?: AvailableModel;
  /** @deprecated Pass this into the Stagehand constructor instead. This will be removed in the next major version. */
  modelClientOptions?: ClientOptions;
  /** @deprecated Pass this into the Stagehand constructor instead. This will be removed in the next major version. */
  domSettleTimeoutMs?: number;
}

export interface InitResult {
  debugUrl: string;
  sessionUrl: string;
  sessionId: string;
}

export interface InitFromPageOptions {
  page: Page;
  /** @deprecated Pass this into the Stagehand constructor instead. This will be removed in the next major version. */
  modelName?: AvailableModel;
  /** @deprecated Pass this into the Stagehand constructor instead. This will be removed in the next major version. */
  modelClientOptions?: ClientOptions;
}

export interface InitFromPageResult {
  context: BrowserContext;
}

export interface ActOptions {
  action: string;
  modelName?: AvailableModel;
  modelClientOptions?: ClientOptions;
  useVision?: "fallback" | boolean;
  variables?: Record<string, string>;
  domSettleTimeoutMs?: number;
}

import { WithTokenUsage } from "./tokenUsage";

export interface ActResult extends WithTokenUsage {
  success: boolean;
  message: string;
  action: string;
}

export interface ExtractOptions<T extends z.AnyZodObject> {
  instruction: string;
  schema: T;
  modelName?: AvailableModel;
  modelClientOptions?: ClientOptions;
  domSettleTimeoutMs?: number;
  useTextExtract?: boolean;
  useVision?: boolean;
}

export type ExtractResult<T extends z.AnyZodObject> = z.infer<T> &
  WithTokenUsage;

export interface ObserveOptions {
  instruction?: string;
  modelName?: AvailableModel;
  modelClientOptions?: ClientOptions;
  useVision?: boolean;
  domSettleTimeoutMs?: number;
  functionName?: string;
}

export interface ObserveResult extends WithTokenUsage {
  selector: string;
  description: string;
}

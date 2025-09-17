import { LaunchedChrome } from "chrome-launcher";
import Browserbase from "@browserbasehq/sdk";
import { Page } from "./understudy/page";
import { AvailableModel, ClientOptions } from "@/types/model";
import { LLMClient } from "@/lib/llm/LLMClient";
import { z } from "zod/v3";
import type { LogLine } from "@/types/log";

export type V3Env = "LOCAL" | "BROWSERBASE";

/** Constructor options for V3 */
export interface V3Options {
  env: V3Env;

  // Browserbase (required when env = "BROWSERBASE")
  apiKey?: string;
  projectId?: string;
  /**
   * Optional: fine-tune Browserbase session creation or resume an existing session.
   */
  browserbaseSessionCreateParams?: Omit<
    Browserbase.Sessions.SessionCreateParams,
    "projectId"
  > & { projectId?: string };
  browserbaseSessionID?: string;

  // Local Chromium (optional)
  chromePath?: string;
  chromeFlags?: string[];
  headless?: boolean;
  userDataDir?: string;

  modelName?: AvailableModel;
  modelClientOptions?: ClientOptions;
  llmClient?: LLMClient; // allow user to pass their own
  enableCaching?: boolean;
  systemPrompt?: string;

  /** How long to wait for a CDP endpoint, in ms (default 15000) */
  connectTimeoutMs?: number;
  logInferenceToFile?: boolean;
  experimental?: boolean;
  verbose?: 0 | 1 | 2;
  selfHeal?: boolean;
  /** Disable pino logging backend (useful for tests or minimal environments). */
  disablePino?: boolean;
  /** Optional external logger hook for integrating with host apps. */
  logger?: (line: LogLine) => void;

  /** Show a visual cursor overlay that follows our mouse events. */
  includeCursor?: boolean;
}

/** Narrow shape we rely on from Browserbase session creation */
export interface BrowserbaseSession {
  id: string;
  connectUrl: string;
}

/** Narrow shape we rely on from /json/version */
export interface JsonVersionResponse {
  webSocketDebuggerUrl: string;
}

export type InitState =
  | { kind: "UNINITIALIZED" }
  | { kind: "LOCAL"; chrome: LaunchedChrome; ws: string }
  | { kind: "BROWSERBASE"; bb: Browserbase; sessionId: string; ws: string };

export type PlaywrightPage = import("playwright-core").Page;
export type PatchrightPage = import("patchright-core").Page;
export type PuppeteerPage = import("puppeteer-core").Page;

export type AnyPage = PlaywrightPage | PuppeteerPage | PatchrightPage | Page;

export type ActParams = {
  instruction: string;
  modelName?: AvailableModel;
  modelClientOptions?: ClientOptions;
  variables?: Record<string, string>;
  domSettleTimeoutMs?: number;
  timeoutMs?: number;
  page?: PlaywrightPage | PuppeteerPage | PatchrightPage | Page;
};

export interface ActHandlerParams {
  instruction: string;
  modelName?: AvailableModel;
  modelClientOptions?: ClientOptions;
  variables?: Record<string, string>;
  domSettleTimeoutMs?: number;
  timeoutMs?: number;
  page: Page;
}

export interface ExtractParams<T extends z.AnyZodObject> {
  instruction?: string;
  schema?: T;
  modelName?: AvailableModel;
  modelClientOptions?: ClientOptions;
  domSettleTimeoutMs?: number;
  selector?: string;
  page?: PlaywrightPage | PuppeteerPage | PatchrightPage | Page;
}

export interface ExtractHandlerParams<T extends z.AnyZodObject> {
  instruction?: string;
  schema?: T;
  modelName?: AvailableModel;
  modelClientOptions?: ClientOptions;
  domSettleTimeoutMs?: number;
  selector?: string;
  page: Page;
}

export const defaultExtractSchema = z.object({
  extraction: z.string(),
});

export const pageTextSchema = z.object({
  page_text: z.string(),
});

export type ObserveParams = {
  instruction?: string;
  modelName?: AvailableModel;
  modelClientOptions?: ClientOptions;
  domSettleTimeoutMs?: number;
  returnAction?: boolean;
  drawOverlay?: boolean;
  page?: PlaywrightPage | PuppeteerPage | PatchrightPage | Page;
};

export interface ObserveHandlerParams {
  instruction?: string;
  modelName?: AvailableModel;
  modelClientOptions?: ClientOptions;
  domSettleTimeoutMs?: number;
  returnAction?: boolean;
  drawOverlay?: boolean;
  fromAct?: boolean;
  page: Page;
}

export type LoadState = "load" | "domcontentloaded" | "networkidle";

export interface V3Metrics {
  actPromptTokens: number;
  actCompletionTokens: number;
  actInferenceTimeMs: number;
  extractPromptTokens: number;
  extractCompletionTokens: number;
  extractInferenceTimeMs: number;
  observePromptTokens: number;
  observeCompletionTokens: number;
  observeInferenceTimeMs: number;
  agentPromptTokens: number;
  agentCompletionTokens: number;
  agentInferenceTimeMs: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalInferenceTimeMs: number;
}

export enum V3FunctionName {
  ACT = "ACT",
  EXTRACT = "EXTRACT",
  OBSERVE = "OBSERVE",
  AGENT = "AGENT",
}

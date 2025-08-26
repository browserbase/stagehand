import { LaunchedChrome } from "chrome-launcher";
import Browserbase from "@browserbasehq/sdk";
import { Page } from "./understudy/page";
import { AvailableModel, ClientOptions } from "@/types/model";
import { LLMClient } from "@/lib/llm/LLMClient";
import { z } from "zod/v3";

export type V3Env = "LOCAL" | "BROWSERBASE";

/** Constructor options for V3 */
export interface V3Options {
  env: V3Env;

  // Browserbase (required when env = "BROWSERBASE")
  apiKey?: string;
  projectId?: string;

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
export type PuppeteerPage = import("puppeteer-core").Page;

export type AnyPage = PlaywrightPage | PuppeteerPage | Page;

export type ActParams = {
  instruction: string;
  modelName?: AvailableModel;
  modelClientOptions?: ClientOptions;
  variables?: Record<string, string>;
  domSettleTimeoutMs?: number;
  timeoutMs?: number;
  page?: PlaywrightPage | PuppeteerPage | Page;
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
  page?: PlaywrightPage | PuppeteerPage | Page;
}

export interface ExtractHandlerParams<T extends z.AnyZodObject> {
  instruction?: string;
  schema?: T;
  modelName?: AvailableModel;
  modelClientOptions?: ClientOptions;
  domSettleTimeoutMs?: number;
  page: Page;
}

export type ObserveParams = {
  instruction?: string;
  modelName?: AvailableModel;
  modelClientOptions?: ClientOptions;
  domSettleTimeoutMs?: number;
  returnAction?: boolean;
  drawOverlay?: boolean;
  page?: PlaywrightPage | PuppeteerPage | Page;
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

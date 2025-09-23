import { LaunchedChrome } from "chrome-launcher";
import Browserbase from "@browserbasehq/sdk";
import { Page } from "./understudy/page";
import { AvailableModel, ClientOptions } from "../v3/types/model";
import { LLMClient } from "./llm/LLMClient";
import { z } from "zod/v3";
import type { ZodTypeAny } from "zod/v3";
import type { LogLine } from "../v3/types/log";

export type V3Env = "LOCAL" | "BROWSERBASE";

/** Local launch options for V3 (chrome-launcher + CDP).
 * Matches v2 shape where feasible; unsupported fields are accepted but ignored.
 */
export interface LocalBrowserLaunchOptions {
  // Launch-time flags / setup
  args?: string[];
  executablePath?: string; // maps to chromePath
  userDataDir?: string;
  preserveUserDataDir?: boolean;
  headless?: boolean;
  devtools?: boolean;
  chromiumSandbox?: boolean; // if false → --no-sandbox
  ignoreDefaultArgs?: boolean | string[];
  proxy?: {
    server: string;
    bypass?: string;
    username?: string;
    password?: string;
  };
  locale?: string; // via --lang
  viewport?: { width: number; height: number };
  deviceScaleFactor?: number; // via --force-device-scale-factor
  hasTouch?: boolean; // via --touch-events=enabled (best-effort)
  ignoreHTTPSErrors?: boolean; // via --ignore-certificate-errors
  cdpUrl?: string; // attach to existing Chrome (expects ws:// URL)
  connectTimeoutMs?: number;

  // Post-connect (best-effort via CDP). Some are TODOs for a later pass.
  downloadsPath?: string; // Browser.setDownloadBehavior
  acceptDownloads?: boolean; // allow/deny via Browser.setDownloadBehavior

  // TODO: implement these?
  // Not yet implemented in V3
  // env?: Record<string, string | number | boolean>;
  // extraHTTPHeaders?: Record<string, string>;
  // geolocation?: { latitude: number; longitude: number; accuracy?: number };
  // bypassCSP?: boolean;
  // cookies?: Array<{
  //   name: string; value: string; url?: string; domain?: string; path?: string;
  //   expires?: number; httpOnly?: boolean; secure?: boolean; sameSite?: "Strict" | "Lax" | "None";
  // }>;
  // timezoneId?: string;
  // permissions?: string[];
  // recordHar?: { omitContent?: boolean; content?: "omit" | "embed" | "attach"; path: string; mode?: "full" | "minimal"; urlFilter?: string | RegExp };
  // recordVideo?: { dir: string; size?: { width: number; height: number } };
  // tracesDir?: string;
}

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
  localBrowserLaunchOptions?: LocalBrowserLaunchOptions;

  modelName?: AvailableModel;
  modelClientOptions?: ClientOptions;
  llmClient?: LLMClient; // allow user to pass their own
  systemPrompt?: string;
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
  | {
      kind: "LOCAL";
      chrome: LaunchedChrome;
      ws: string;
      userDataDir?: string;
      createdTempProfile?: boolean;
      preserveUserDataDir?: boolean;
    }
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

// Base extract params (without inline schema fields)
export interface BaseExtractParams<T extends z.AnyZodObject> {
  instruction?: string;
  schema?: T;
  modelName?: AvailableModel;
  modelClientOptions?: ClientOptions;
  domSettleTimeoutMs?: number;
  timeoutMs?: number;
  selector?: string;
  page?: PlaywrightPage | PuppeteerPage | PatchrightPage | Page;
}

// Allow callers to supply top-level inline Zod fields alongside instruction, e.g.:
// v3.extract({ instruction: "...", title: z.string(), url: z.string().url() })
// This index signature explicitly excludes known base keys to avoid type collisions.
export type ExtractParams<T extends z.AnyZodObject> = BaseExtractParams<T> & {
  [K in Exclude<string, keyof BaseExtractParams<T>>]?: ZodTypeAny;
};

// Public helper type for inline schema fields (excludes base extract keys)
export type InlineSchemaShape<T extends z.AnyZodObject = z.AnyZodObject> = {
  [K in Exclude<string, keyof BaseExtractParams<T>>]?: ZodTypeAny;
};

// Utility: pick only the inline Zod fields from a params object P,
// excluding base extract keys and instruction/schema.
export type InlineFrom<P> = {
  [K in keyof P as K extends
    | keyof BaseExtractParams<z.AnyZodObject>
    | "instruction"
    | "schema"
    ? never
    : P[K] extends ZodTypeAny
      ? K
      : never]: P[K] extends ZodTypeAny ? P[K] : never;
};

export interface ExtractHandlerParams<T extends z.AnyZodObject> {
  instruction?: string;
  schema?: T;
  modelName?: AvailableModel;
  modelClientOptions?: ClientOptions;
  domSettleTimeoutMs?: number;
  timeoutMs?: number;
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
  timeoutMs?: number;
  returnAction?: boolean;
  drawOverlay?: boolean;
  page?: PlaywrightPage | PuppeteerPage | PatchrightPage | Page;
};

export interface ObserveHandlerParams {
  instruction?: string;
  modelName?: AvailableModel;
  modelClientOptions?: ClientOptions;
  domSettleTimeoutMs?: number;
  timeoutMs?: number;
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

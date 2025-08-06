import Browserbase from "@browserbasehq/sdk";
import { z } from "zod/v3";
import { LLMProvider } from "../lib/llm/LLMProvider";
import { LogLine } from "./log";
import { AvailableModel, ClientOptions } from "./model";
import { LLMClient } from "../lib/llm/LLMClient";
import { Cookie } from "playwright";
import { AgentProviderType } from "./agent";

export interface ConstructorParams {
  /**
   * The environment to use for Stagehand
   */
  env: "LOCAL" | "BROWSERBASE";
  /**
   * Your Browserbase API key
   */
  apiKey?: string;
  /**
   * Your Browserbase project ID
   */
  projectId?: string;
  /**
   * The verbosity of the Stagehand logger
   * 0 - No logs
   * 1 - Only errors
   * 2 - All logs
   */
  verbose?: 0 | 1 | 2;
  /**
   * The LLM provider to use for Stagehand
   * See
   */
  llmProvider?: LLMProvider;
  /**
   * The logger to use for Stagehand
   */
  logger?: (message: LogLine) => void | Promise<void>;
  /**
   * The timeout to use for the DOM to settle
   * @default 10000
   */
  domSettleTimeoutMs?: number;
  /**
   * The parameters to use for creating a Browserbase session
   * See https://docs.browserbase.com/reference/api/create-a-session
   */
  browserbaseSessionCreateParams?: Browserbase.Sessions.SessionCreateParams;
  /**
   * Enable caching of LLM responses
   * @default true
   */
  enableCaching?: boolean;
  /**
   * The ID of a Browserbase session to resume
   */
  browserbaseSessionID?: string;
  /**
   * The model to use for Stagehand
   */
  modelName?: AvailableModel;
  /**
   * The LLM client to use for Stagehand
   */
  llmClient?: LLMClient;
  /**
   * The parameters to use for the LLM client
   * Useful for parameterizing LLM API Keys
   */
  modelClientOptions?: ClientOptions;
  /**
   * Customize the Stagehand system prompt
   */
  systemPrompt?: string;
  /**
   * Offload Stagehand method calls to the Stagehand API.
   * Must have a valid API key to use
   */
  useAPI?: boolean;
  /**
   * Wait for captchas to be solved after navigation when using Browserbase environment.
   *
   * @default false
   */
  waitForCaptchaSolves?: boolean;
  /**
   * The parameters to use for launching a local browser
   */
  localBrowserLaunchOptions?: LocalBrowserLaunchOptions;
  /**
   * Log the inference to a file
   */
  logInferenceToFile?: boolean;
  selfHeal?: boolean;
  /**
   * Disable Pino (helpful for Next.js or test environments)
   */
  disablePino?: boolean;
  /**
   * Experimental Flag: Enables the latest experimental features
   */
  experimental?: boolean;
}

export interface InitResult {
  debugUrl: string;
  sessionUrl: string;
  sessionId: string;
}

export interface ActOptions {
  action: string;
  modelName?: AvailableModel;
  modelClientOptions?: ClientOptions;
  variables?: Record<string, string>;
  domSettleTimeoutMs?: number;
  timeoutMs?: number;
  iframes?: boolean;
  frameId?: string;
}

export interface ActResult {
  success: boolean;
  message: string;
  action: string;
}

export interface ExtractOptions<T extends z.AnyZodObject> {
  instruction?: string;
  schema?: T;
  modelName?: AvailableModel;
  modelClientOptions?: ClientOptions;
  domSettleTimeoutMs?: number;
  /**
   * @deprecated The `useTextExtract` parameter has no effect in this version of Stagehand and will be removed in later versions.
   */
  useTextExtract?: boolean;
  selector?: string;
  iframes?: boolean;
  frameId?: string;
}

export type ExtractResult<T extends z.AnyZodObject> = z.infer<T>;

export interface ObserveOptions {
  instruction?: string;
  modelName?: AvailableModel;
  modelClientOptions?: ClientOptions;
  domSettleTimeoutMs?: number;
  returnAction?: boolean;
  /**
   * @deprecated The `onlyVisible` parameter has no effect in this version of Stagehand and will be removed in later versions.
   */
  onlyVisible?: boolean;
  drawOverlay?: boolean;
  iframes?: boolean;
  frameId?: string;
}

export interface ObserveResult {
  selector: string;
  description: string;
  backendNodeId?: number;
  method?: string;
  arguments?: string[];
}

export interface LocalBrowserLaunchOptions {
  args?: string[];
  chromiumSandbox?: boolean;
  devtools?: boolean;
  env?: Record<string, string | number | boolean>;
  executablePath?: string;
  handleSIGHUP?: boolean;
  handleSIGINT?: boolean;
  handleSIGTERM?: boolean;
  headless?: boolean;
  ignoreDefaultArgs?: boolean | Array<string>;
  proxy?: {
    server: string;
    bypass?: string;
    username?: string;
    password?: string;
  };
  tracesDir?: string;
  userDataDir?: string;
  preserveUserDataDir?: boolean;
  acceptDownloads?: boolean;
  downloadsPath?: string;
  extraHTTPHeaders?: Record<string, string>;
  geolocation?: { latitude: number; longitude: number; accuracy?: number };
  hasTouch?: boolean;
  ignoreHTTPSErrors?: boolean;
  locale?: string;
  permissions?: Array<string>;
  recordHar?: {
    omitContent?: boolean;
    content?: "omit" | "embed" | "attach";
    path: string;
    mode?: "full" | "minimal";
    urlFilter?: string | RegExp;
  };
  recordVideo?: { dir: string; size?: { width: number; height: number } };
  viewport?: { width: number; height: number };
  deviceScaleFactor?: number;
  timezoneId?: string;
  bypassCSP?: boolean;
  cookies?: Cookie[];
  cdpUrl?: string;
}

export interface StagehandMetrics {
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

/**
 * Options for executing a task with an agent
 */
export interface AgentExecuteParams {
  /**
   * The instruction to execute with the agent
   */
  instruction: string;
  /**
   * Maximum number of steps the agent can take to complete the task
   * @default 10
   */
  maxSteps?: number;
  /**
   * Take a screenshot automatically before each agent step
   * @default true
   */
  autoScreenshot?: boolean;
  /**
   * Wait time in milliseconds between agent actions
   * @default 0
   */
  waitBetweenActions?: number;
  /**
   * Additional context to provide to the agent
   */
  context?: string;
}

/**
 * Configuration for agent functionality
 */
export interface AgentConfig {
  /**
   * The provider to use for agent functionality
   */
  provider?: AgentProviderType;
  /**
   * The model to use for agent functionality
   */
  model?: string;
  /**
   * Custom instructions to provide to the agent
   */
  instructions?: string;
  /**
   * Additional options to pass to the agent client
   */
  options?: Record<string, unknown>;
}

export enum StagehandFunctionName {
  ACT = "ACT",
  EXTRACT = "EXTRACT",
  OBSERVE = "OBSERVE",
  AGENT = "AGENT",
}

export interface HistoryEntry {
  method: "act" | "extract" | "observe" | "navigate";
  parameters: unknown;
  result: unknown;
  timestamp: string;
}

/**
 * Represents a path through a Zod schema from the root object down to a
 * particular field. The `segments` array describes the chain of keys/indices.
 *
 * - **String** segments indicate object property names.
 * - **Number** segments indicate array indices.
 *
 * For example, `["users", 0, "homepage"]` might describe reaching
 * the `homepage` field in `schema.users[0].homepage`.
 */
export interface ZodPathSegments {
  /**
   * The ordered list of keys/indices leading from the schema root
   * to the targeted field.
   */
  segments: Array<string | number>;
}

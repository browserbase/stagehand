import { z } from "zod";
import { LLMClient } from "../../llm/LLMClient.js";
import { ModelConfiguration } from "./model.js";
import { LogLine } from "./logs.js";
import {
  type BrowserbaseSessionCreateParams,
  LocalBrowserLaunchOptionsSchema,
} from "./api.js";

export type V3Env = "LOCAL" | "BROWSERBASE";

// Re-export for backwards compatibility (camelCase alias)
export const localBrowserLaunchOptionsSchema = LocalBrowserLaunchOptionsSchema;

export type LocalBrowserLaunchOptions = z.infer<
  typeof LocalBrowserLaunchOptionsSchema
>;

/** Constructor options for V3 */
export interface V3Options {
  env: V3Env;
  // Browserbase (required when env = "BROWSERBASE")
  apiKey?: string;
  projectId?: string;
  /**
   * Optional: fine-tune Browserbase session creation or resume an existing session.
   */
  browserbaseSessionCreateParams?: BrowserbaseSessionCreateParams;
  browserbaseSessionID?: string;
  /**
   * Controls browser keepalive behavior. When set, it overrides any value in
   * browserbaseSessionCreateParams.keepAlive.
   */
  keepAlive?: boolean;

  // Local Chromium (optional)
  localBrowserLaunchOptions?: LocalBrowserLaunchOptions;

  model?: ModelConfiguration;
  llmClient?: LLMClient; // allow user to pass their own
  systemPrompt?: string;
  logInferenceToFile?: boolean;
  experimental?: boolean;
  verbose?: 0 | 1 | 2;
  selfHeal?: boolean;
  // V2 compatibility fields - only included because the server imports this type and supports V2
  waitForCaptchaSolves?: boolean;
  actTimeoutMs?: number;
  /** Disable pino logging backend (useful for tests or minimal environments). */
  disablePino?: boolean;
  /** Optional external logger hook for integrating with host apps. */
  logger?: (line: LogLine) => void;
  /** Directory used to persist cached actions for act(). */
  cacheDir?: string;
  domSettleTimeout?: number;
  disableAPI?: boolean;
  /**
   * Server-side cache threshold configuration per method.
   * Overrides the LaunchDarkly flag threshold for the specified methods.
   * Can be a boolean (true = use server cache with default threshold) or
   * an object with a threshold number specifying the minimum hit count
   * before cached results are returned.
   * Method-level serverCache options take precedence over these constructor values.
   */
  serverCache?: {
    act?: boolean | { threshold: number };
    extract?: boolean | { threshold: number };
    observe?: boolean | { threshold: number };
  };
}

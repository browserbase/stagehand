import { z } from "zod";
import { LLMClient } from "../../llm/LLMClient";
import { ModelConfiguration } from "./model";
import { LogLine } from "./logs";
import {
  type BrowserbaseSessionCreateParams,
  LocalBrowserLaunchOptionsSchema,
} from "./api";

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
}

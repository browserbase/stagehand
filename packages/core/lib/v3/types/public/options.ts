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
  /**
   * Optional external session identifier to use for flow logging/event storage.
   * When omitted, Stagehand falls back to its internal instance id.
   * This currently ends up 1:1 with the Browserbase session id when one exists,
   * but callers should not rely on that remaining a permanent invariant.
   */
  sessionId?: string;
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

  /**
   * Actuate coordinate pointer actions as touch (a real `Input.dispatchTouchEvent`
   * tap) instead of mouse input. Mobile layouts commonly gate their handlers on
   * touch/pointer events, where a synthesized mouse click never registers — e.g. a
   * size selector that keeps reporting "please choose a size".
   *
   * When omitted this is derived from the session: a Browserbase session with
   * `browserSettings.os` of `"mobile"` or `"tablet"`, or a local session launched
   * with `localBrowserLaunchOptions.hasTouch`. Set it explicitly to override that,
   * which is also the way to opt in when resuming a session via
   * `browserbaseSessionID` (where the original `browserSettings` are not known here).
   */
  useTouch?: boolean;

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
   * When true, enables server-side caching for API requests.
   * When false, disables server-side caching.
   * Defaults to true (caching enabled).
   * Can be overridden per-method in act(), extract(), and observe() options.
   */
  serverCache?: boolean;
}

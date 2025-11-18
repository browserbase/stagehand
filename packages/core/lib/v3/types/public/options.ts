import Browserbase from "@browserbasehq/sdk";
import { LLMClient } from "../../llm/LLMClient";
import { ModelConfiguration } from "./model";
import { LogLine } from "./logs";

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

  model?: ModelConfiguration;
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
  /** Directory used to persist cached actions for act(). */
  cacheDir?: string;
  domSettleTimeout?: number;
  disableAPI?: boolean;
  manual?: boolean;
}

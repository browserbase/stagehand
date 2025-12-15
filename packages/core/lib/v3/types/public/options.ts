import Browserbase from "@browserbasehq/sdk";
import { z } from "zod";
import { LLMClient } from "../../llm/LLMClient";
import { ModelConfiguration } from "./model";
import { LogLine } from "./logs";

export type V3Env = "LOCAL" | "BROWSERBASE";

export const localBrowserLaunchOptionsSchema = z
  .object({
    // Launch-time flags / setup
    args: z.array(z.string()).optional(),
    executablePath: z.string().optional(), // maps to chromePath
    userDataDir: z.string().optional(),
    preserveUserDataDir: z.boolean().optional(),
    headless: z.boolean().optional(),
    devtools: z.boolean().optional(),
    chromiumSandbox: z.boolean().optional(), // if false → --no-sandbox
    ignoreDefaultArgs: z.union([z.boolean(), z.array(z.string())]).optional(),
    proxy: z
      .object({
        server: z.string(),
        bypass: z.string().optional(),
        username: z.string().optional(),
        password: z.string().optional(),
      })
      .optional(),
    locale: z.string().optional(), // via --lang
    viewport: z.object({ width: z.number(), height: z.number() }).optional(),
    deviceScaleFactor: z.number().optional(), // via --force-device-scale-factor
    hasTouch: z.boolean().optional(), // via --touch-events=enabled (best-effort)
    ignoreHTTPSErrors: z.boolean().optional(), // via --ignore-certificate-errors
    cdpUrl: z.string().optional(), // attach to existing Chrome (expects ws:// URL)
    connectTimeoutMs: z.number().optional(),

    // Post-connect (best-effort via CDP)
    downloadsPath: z.string().optional(), // Browser.setDownloadBehavior
    acceptDownloads: z.boolean().optional(), // allow/deny via Browser.setDownloadBehavior

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
  })
  .strict();

export type LocalBrowserLaunchOptions = z.infer<
  typeof localBrowserLaunchOptionsSchema
>;

/** Constructor options for V3 */
export interface V3Options {
  env: V3Env;
  // Browserbase (required when env = "BROWSERBASE")
  apiKey?: string;
  projectId?: string;
  browser?: {
    type?: "browserbase" | "local";
    cdpUrl?: string;
    launchOptions?: LocalBrowserLaunchOptions;
  };
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
}

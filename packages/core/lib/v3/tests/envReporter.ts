import type { Reporter, TestCase } from "@playwright/test/reporter";
import { getV3DynamicTestConfig } from "./v3.dynamic.config";

type ConfigSummary = {
  env?: string;
  disableAPI?: boolean;
  selfHeal?: boolean;
  experimental?: boolean;
  localBrowserLaunchOptions?: {
    headless?: boolean;
    viewport?: { width?: number; height?: number };
    hasExecutablePath?: boolean;
    argsCount?: number;
  };
  browserbaseSessionCreateParams?: {
    region?: string;
    hasViewport?: boolean;
  };
  error?: string;
};

function summarizeV3Config(): ConfigSummary {
  try {
    const cfg = getV3DynamicTestConfig();
    return {
      env: cfg.env,
      disableAPI: cfg.disableAPI,
      selfHeal: cfg.selfHeal,
      experimental: cfg.experimental,
      localBrowserLaunchOptions: cfg.localBrowserLaunchOptions
        ? {
            headless: cfg.localBrowserLaunchOptions.headless,
            viewport: cfg.localBrowserLaunchOptions.viewport,
            hasExecutablePath: Boolean(
              cfg.localBrowserLaunchOptions.executablePath,
            ),
            argsCount: cfg.localBrowserLaunchOptions.args?.length ?? 0,
          }
        : undefined,
      browserbaseSessionCreateParams: cfg.browserbaseSessionCreateParams
        ? {
            region: cfg.browserbaseSessionCreateParams.region,
            hasViewport: Boolean(
              cfg.browserbaseSessionCreateParams.browserSettings?.viewport,
            ),
          }
        : undefined,
    };
  } catch (error) {
    return { error: String(error) };
  }
}

function summarizeEnv() {
  return {
    STAGEHAND_ENV: process.env.STAGEHAND_ENV, // STAGEHAND_ENV = 'LOCAL' | 'BROWSERBASE'                      (client setting passed to Stagehand(env) init param)
    BB_ENV: process.env.BB_ENV, // BB_ENV = 'local' | 'dev' | 'prod'                            (hosting environment the stagehand-api server is running in)
    NODE_ENV: process.env.NODE_ENV, // NODE_ENV = 'development' | 'test' | 'production' | 'staging' (used only to control logging)
    CI: process.env.CI, // CI = 'true' | 'false'                                        (used only to control test parallelism and pnpm prepare script)
    STAGEHAND_API_URL: process.env.STAGEHAND_API_URL,
    BROWSERBASE_REGION: process.env.BROWSERBASE_REGION,
    BROWSERBASE_API_KEY: process.env.BROWSERBASE_API_KEY
      ? "[redacted]"
      : "missing!",
    BROWSERBASE_PROJECT_ID: process.env.BROWSERBASE_PROJECT_ID
      ? "[redacted]"
      : "missing!",
  };
}

export default class EnvReporter implements Reporter {
  onTestBegin(test: TestCase): void {
    const payload = {
      test: test.titlePath().join(" > "),
      env: summarizeEnv(),
      config: summarizeV3Config(),
    };
    console.log(`[e2e-env] ${JSON.stringify(payload)}`);
  }
}

import type { V3Options } from "../../lib/v3/types/public/options.js";
import type { BrowserbaseSessionCreateParams } from "../../lib/v3/types/public/api.js";
import type { LogLine } from "../../lib/v3/types/public/logs.js";

const browserTarget = (
  process.env.STAGEHAND_BROWSER_TARGET ?? "local"
).toLowerCase();
const isBrowserbase = browserTarget === "browserbase";
const browserbaseRegionRaw = process.env.BROWSERBASE_REGION;
const browserbaseRegion = (
  [
    "us-west-2",
    "us-east-1",
    "eu-central-1",
    "ap-southeast-1",
  ] as BrowserbaseSessionCreateParams["region"][]
).includes(browserbaseRegionRaw as BrowserbaseSessionCreateParams["region"])
  ? (browserbaseRegionRaw as BrowserbaseSessionCreateParams["region"])
  : undefined;

const baseConfig = {
  verbose: 0 as const,
  disablePino: true,
  logger: (line: LogLine) => console.log(line),
  disableAPI: true,
};

export const v3DynamicTestConfig: V3Options = isBrowserbase
  ? {
      ...baseConfig,
      env: "BROWSERBASE",
      apiKey: process.env.BROWSERBASE_API_KEY!,
      projectId: process.env.BROWSERBASE_PROJECT_ID!,
      disableAPI: true,
      selfHeal: false,
      ...(browserbaseRegion
        ? { browserbaseSessionCreateParams: { region: browserbaseRegion } }
        : {}),
    }
  : {
      ...baseConfig,
      env: "LOCAL",
      localBrowserLaunchOptions: {
        executablePath: process.env.CHROME_PATH,
        args: process.env.CI ? ["--no-sandbox"] : undefined,
        headless: true,
        viewport: { width: 1288, height: 711 },
      },
    };

export function getV3DynamicTestConfig(
  overrides: Partial<V3Options> = {},
): V3Options {
  return { ...v3DynamicTestConfig, ...overrides };
}

export default getV3DynamicTestConfig;

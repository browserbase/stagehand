import type { V3Options } from "../types/public/options";
import type { BrowserbaseSessionCreateParams } from "../types/public/api";
import type { LogLine } from "../types/public/logs";
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";

dotenv.config();

const resolveRepoRoot = (startDir: string): string => {
  let current = startDir;
  while (true) {
    if (fs.existsSync(path.join(current, "pnpm-workspace.yaml"))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return startDir;
    }
    current = parent;
  }
};

const repoRoot = resolveRepoRoot(process.cwd());

const rootEnvPath = path.join(repoRoot, ".env");
dotenv.config({ path: rootEnvPath, override: false });

const localTestEnvPath = path.join(
  repoRoot,
  "packages",
  "core",
  "lib",
  "v3",
  "tests",
  ".env",
);
dotenv.config({ path: localTestEnvPath, override: false });

// Determine environment from STAGEHAND_ENV variable
const testEnv = process.env.STAGEHAND_ENV || "LOCAL";
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

export const v3DynamicTestConfig: V3Options =
  testEnv === "BROWSERBASE"
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

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

export const v3BBTestConfig: V3Options = {
  env: "BROWSERBASE",
  apiKey: process.env.BROWSERBASE_API_KEY!,
  projectId: process.env.BROWSERBASE_PROJECT_ID!,
  verbose: 0,
  disablePino: true,
  disableAPI: true,
  logger: (line: LogLine) => console.log(line),
  ...(browserbaseRegion
    ? { browserbaseSessionCreateParams: { region: browserbaseRegion } }
    : {}),
};

export function getV3BBTestConfig(
  overrides: Partial<V3Options> = {},
): V3Options {
  return { ...v3BBTestConfig, ...overrides };
}

export default getV3BBTestConfig;

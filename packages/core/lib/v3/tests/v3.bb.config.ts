import type { V3Options } from "../types/public/options";
import type { LogLine } from "../types/public/logs";
import dotenv from "dotenv";
import path from "path";

dotenv.config();

const rootEnvPath = path.resolve(__dirname, "../../../.env");
dotenv.config({ path: rootEnvPath, override: false });

const localTestEnvPath = path.resolve(__dirname, ".env");
dotenv.config({ path: localTestEnvPath, override: false });

export const v3BBTestConfig: V3Options = {
  env: "BROWSERBASE",
  apiKey: process.env.BROWSERBASE_API_KEY!,
  projectId: process.env.BROWSERBASE_PROJECT_ID!,
  verbose: 0,
  disablePino: true,
  logger: (line: LogLine) => console.log(line),
};

export function getV3BBTestConfig(
  overrides: Partial<V3Options> = {},
): V3Options {
  return { ...v3BBTestConfig, ...overrides };
}

export default getV3BBTestConfig;

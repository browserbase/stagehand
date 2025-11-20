import type { V3Options } from "../types/public/options";
import type { LogLine } from "../types/public/logs";
import dotenv from "dotenv";
import path from "path";

dotenv.config();

const rootEnvPath = path.resolve(__dirname, "../../../.env");
dotenv.config({ path: rootEnvPath, override: false });

const localTestEnvPath = path.resolve(__dirname, ".env");
dotenv.config({ path: localTestEnvPath, override: false });

// Determine environment from TEST_ENV variable
const testEnv = process.env.TEST_ENV || "LOCAL";

const baseConfig = {
  verbose: 0 as const,
  disablePino: true,
  logger: (line: LogLine) => console.log(line),
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
      }
    : {
        ...baseConfig,
        env: "LOCAL",
        localBrowserLaunchOptions: {
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

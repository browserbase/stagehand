import path from "node:path";
import { defineConfig } from "drizzle-kit";
import { constants } from "./src/constants";
import { env } from "./src/env";

const drizzleConfig =
  env.STAGEHAND_DB_MODE === "postgres"
    ? {
        dialect: "postgresql" as const,
        dbCredentials: {
          url: env.DATABASE_URL,
        },
      }
    : {
        dialect: "postgresql" as const,
        driver: "pglite" as const,
        dbCredentials: {
          url: path.resolve(
            env.BROWSERBASE_CONFIG_DIR,
            ...constants.paths.pgliteDataDirSegments,
          ),
        },
      };

export default defineConfig({
  out: "./drizzle",
  schema: "./src/db/schema/index.ts",
  ...drizzleConfig,
  strict: true,
  verbose: true,
});

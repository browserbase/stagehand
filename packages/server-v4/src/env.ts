import os from "node:os";
import path from "node:path";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";
import { constants } from "./constants.js";

export type DatabaseMode = "postgres" | "pglite";

const defaultConfigDir = path.resolve(
  os.homedir(),
  constants.paths.defaultConfigDirName,
);

export const parseEnvironment = (runtimeEnv: NodeJS.ProcessEnv) => {
  const parsedEnv = createEnv({
    clientPrefix: "",
    client: {},
    server: {
      BROWSERBASE_CONFIG_DIR: z
        .string()
        .min(1)
        .transform((dir) => path.resolve(dir))
        .default(defaultConfigDir),
      NODE_ENV: z
        .enum(["development", "test", "production"])
        .default("development"),
      PORT: z.coerce.number().int().positive().default(3000),
      STAGEHAND_DB_MODE: z.enum(["postgres", "pglite"]).default("pglite"),
      DATABASE_URL: z.url().default(constants.urls.defaultDatabaseUrl),
    },
    runtimeEnvStrict: {
      BROWSERBASE_CONFIG_DIR: runtimeEnv.BROWSERBASE_CONFIG_DIR,
      NODE_ENV: runtimeEnv.NODE_ENV,
      PORT: runtimeEnv.PORT,
      STAGEHAND_DB_MODE: runtimeEnv.STAGEHAND_DB_MODE,
      DATABASE_URL: runtimeEnv.DATABASE_URL,
    },
    emptyStringAsUndefined: true,
  });

  if (
    parsedEnv.STAGEHAND_DB_MODE === "postgres" &&
    parsedEnv.DATABASE_URL === constants.urls.defaultDatabaseUrl
  ) {
    throw new Error("DATABASE_URL must be set when STAGEHAND_DB_MODE=postgres");
  }

  return parsedEnv;
};

export const env = parseEnvironment(process.env);

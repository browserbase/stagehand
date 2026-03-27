import os from "node:os";
import path from "node:path";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";
import { constants } from "./constants.js";

export type DatabaseMode = "postgres" | "pglite";

export const parseEnvironment = (runtimeEnv: NodeJS.ProcessEnv) => {
  const baseEnv = createEnv({
    clientPrefix: undefined,
    client: {},
    server: {
      BROWSERBASE_CONFIG_DIR: z
        .string()
        .min(1)
        .default(
          path.resolve(os.homedir(), constants.paths.defaultConfigDirName),
        ),
      NODE_ENV: z
        .enum(["development", "test", "production"])
        .default("development"),
      PORT: z.coerce.number().int().positive().default(3000),
      STAGEHAND_DB_MODE: z.enum(["postgres", "pglite"]).default("pglite"),
      DATABASE_URL: z.url().optional(),
    },
    runtimeEnv,
    emptyStringAsUndefined: true,
  });

  const databaseEnvSchema = z.discriminatedUnion("STAGEHAND_DB_MODE", [
    z
      .object({
        STAGEHAND_DB_MODE: z.literal("postgres"),
        DATABASE_URL: z.url(),
      })
      .strict(),
    z
      .object({
        STAGEHAND_DB_MODE: z.literal("pglite"),
      })
      .strict(),
  ]);

  const databaseEnv =
    baseEnv.STAGEHAND_DB_MODE === "postgres"
      ? databaseEnvSchema.parse({
          STAGEHAND_DB_MODE: "postgres",
          DATABASE_URL: baseEnv.DATABASE_URL,
        })
      : databaseEnvSchema.parse({
          STAGEHAND_DB_MODE: "pglite",
        });

  return {
    ...baseEnv,
    ...databaseEnv,
  } as const;
};

export const env = parseEnvironment(process.env);

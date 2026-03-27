import os from "node:os";
import path from "node:path";
import { createEnv } from "@t3-oss/env-core";
import { constants } from "./constants.js";
import { z } from "zod";

export const parseEnvironment = (runtimeEnv: NodeJS.ProcessEnv) =>
  createEnv({
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
    },
    runtimeEnv,
    emptyStringAsUndefined: true,
  });

export const env = parseEnvironment(process.env);

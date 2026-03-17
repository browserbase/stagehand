import { createEnv } from "@t3-oss/env-core";
import { z } from "zod/v4";

// Temporarily defining here until browserbase zod package is updated to 3.25.0+
const bbEnvSchema = z.enum(["local", "dev", "prod"]);

export const env = createEnv({
  server: {
    NODE_ENV: z.enum(["development", "production", "staging", "test"]),
    BB_ENV: bbEnvSchema,
  },
  client: {},
  clientPrefix: "PUBLIC_",
  runtimeEnv: {
    NODE_ENV: process.env.NODE_ENV ?? "production",
    BB_ENV: process.env.BB_ENV ?? "local",
  },
});

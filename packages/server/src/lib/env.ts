import { createEnv } from "@t3-oss/env-nextjs";
import dotenv from "dotenv";
import { z } from "zod/v3";

dotenv.config();

// Temporarily defining here until browserbase zod package is updated to 3.25.0+
const bbEnvSchema = z.enum(["local", "dev", "prod"]);

export const env = createEnv({
  server: {
    DB_HOSTNAME: z.string().min(1),
    DB_NAME: z.string().min(1),
    DB_PASSWORD: z.string().min(1),
    DB_PORT: z.string().min(1),
    DB_USERNAME: z.string().min(1),
    NODE_ENV: z.enum(["development", "production"]),
    BB_ENV: bbEnvSchema,
    SENTRY_DSN: z.string().min(1),
    BB_API_BASE_URL: z.string().min(1),
    BB_CONNECT_BASE_URL: z.string().min(1),
    LAUNCHDARKLY_SDK_KEY: z.string().min(1),
    LAUNCHDARKLY_ENVIRONMENT_KEY: z.string().min(1),
  },
  client: {},
  runtimeEnv: {
    DB_HOSTNAME: process.env.DB_HOSTNAME,
    DB_NAME: process.env.DB_NAME,
    DB_PASSWORD: process.env.DB_PASSWORD,
    DB_PORT: process.env.DB_PORT,
    DB_USERNAME: process.env.DB_USERNAME,
    NODE_ENV: process.env.NODE_ENV,
    BB_ENV: process.env.BB_ENV,
    SENTRY_DSN: process.env.SENTRY_DSN,
    BB_API_BASE_URL: process.env.BB_API_BASE_URL,
    BB_CONNECT_BASE_URL: process.env.BB_CONNECT_BASE_URL,
    LAUNCHDARKLY_SDK_KEY: process.env.LAUNCHDARKLY_SDK_KEY,
    LAUNCHDARKLY_ENVIRONMENT_KEY: process.env.LAUNCHDARKLY_ENVIRONMENT_KEY,
  },
});

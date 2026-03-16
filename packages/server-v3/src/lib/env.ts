import { createEnv } from "@t3-oss/env-core";
import { z } from "zod/v4";

// Temporarily defining here until browserbase zod package is updated to 3.25.0+
const bbEnvSchema = z.enum(["local", "dev", "prod"]);

type EnvIssue = {
  code?: string;
  message?: string;
  path?: ReadonlyArray<PropertyKey | { key: PropertyKey } | undefined>;
  values?: ReadonlyArray<string | number | boolean>;
};

const getPathKey = (
  part: PropertyKey | { key: PropertyKey } | undefined,
): string | undefined =>
  typeof part === "string"
    ? part
    : part &&
        typeof part === "object" &&
        "key" in part &&
        typeof part.key === "string"
      ? part.key
      : undefined;

const formatEnvValuePreview = (input: unknown): string | null => {
  if (input === undefined) return null;
  const value = String(input);
  return `'${value.slice(0, 3).replaceAll("\\", "\\\\").replaceAll("'", "\\'")}${value.length > 3 ? "..." : ""}'`;
};

function formatInvalidEnvNames(
  issues: ReadonlyArray<EnvIssue>,
  runtimeEnv: Record<string, string | boolean | number | undefined>,
): string {
  return [
    ...new Set(
      issues.map((issue) => {
        const name = issue.path?.map(getPathKey).find(Boolean) ?? "<unknown>";
        const valuePreview =
          name === "<unknown>" ? null : formatEnvValuePreview(runtimeEnv[name]);
        const reason =
          issue.code === "invalid_value" && issue.values?.length
            ? `${valuePreview ?? "value"} (expected one of: ${issue.values.map((value) => JSON.stringify(value)).join(", ")})`
            : valuePreview === null
              ? "is required"
              : valuePreview && issue.message
                ? `${valuePreview} (${issue.message})`
                : (issue.message ?? "failed validation");
        return `${name}: ${reason}`;
      }),
    ),
  ].join("; ");
}

const runtimeEnv = {
  NODE_ENV: process.env.NODE_ENV ?? "production",
  BB_ENV: process.env.BB_ENV ?? "local",
};

export const env = createEnv({
  server: {
    NODE_ENV: z.enum(["development", "production", "staging", "test"]),
    BB_ENV: bbEnvSchema,
  },
  client: {},
  clientPrefix: "PUBLIC_",
  runtimeEnv,
  onValidationError: (issues) => {
    const invalidNames = formatInvalidEnvNames(issues, runtimeEnv);
    console.error(`❌ Invalid environment variables: ${invalidNames}`);
    throw new Error(`Invalid environment variables: ${invalidNames}`);
  },
});

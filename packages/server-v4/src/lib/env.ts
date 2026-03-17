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

// Formats zod env validation errors into compact "NAME: reason" pairs.
function formatInvalidEnvNames(
  issues: ReadonlyArray<EnvIssue>,
  runtimeEnv: Record<string, string | boolean | number | undefined>,
): string {
  const key = (part: PropertyKey | { key: PropertyKey } | undefined) =>
    typeof part === "string"
      ? part
      : part &&
          typeof part === "object" &&
          "key" in part &&
          typeof part.key === "string"
        ? part.key
        : undefined;
  const preview = (value: unknown) =>
    value == null
      ? null
      : `'${String(value).slice(0, 3).replaceAll("\\", "\\\\").replaceAll("'", "\\'")}${String(value).length > 3 ? "..." : ""}'`;
  return [
    ...new Set(
      issues.map((issue) => {
        const name = issue.path?.map(key).find(Boolean) ?? "<unknown>";
        const value = name === "<unknown>" ? null : preview(runtimeEnv[name]);
        const reason =
          issue.code === "invalid_value" && issue.values?.length
            ? `${value ?? "value"} (expected one of: ${issue.values.map((entry) => JSON.stringify(entry)).join(", ")})`
            : value === null
              ? "is required"
              : value && issue.message
                ? `${value} (${issue.message})`
                : (issue.message ?? "failed validation");
        return `${name}: ${reason}`;
      }),
    ),
  ].join("; ");
}

// Runtime env defaults used both for validation and error reporting.
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

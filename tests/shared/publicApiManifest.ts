import type { PublicErrorTypeKey } from "./publicErrorTypeKeys";
import { PUBLIC_ERROR_TYPE_KEYS } from "./publicErrorTypeKeys";

export const PUBLIC_API_EXPORT_KEYS = [
  "AISdkClient",
  "AVAILABLE_CUA_MODELS",
  "AgentProvider",
  "AnnotatedScreenshotText",
  "ConsoleMessage",
  "LLMClient",
  "LOG_LEVEL_NAMES",
  "Response",
  "Stagehand",
  "V3",
  "V3Evaluator",
  "V3FunctionName",
  "connectToMCPServer",
  "defaultExtractSchema",
  "getZodType",
  "injectUrls",
  "isRunningInBun",
  "isZod3Schema",
  "isZod4Schema",
  "jsonSchemaToZod",
  "loadApiKeyFromEnv",
  "modelToAgentProviderMap",
  "pageTextSchema",
  "providerEnvVarMap",
  "toGeminiSchema",
  "toJsonSchema",
  "transformSchema",
  "trimTrailingTextNode",
  "validateZodSchema",
] as const;

export type PublicApiExportKey = (typeof PUBLIC_API_EXPORT_KEYS)[number];

export type PublicApiShape<M extends Record<string, unknown>, D> = {
  [K in
    | PublicApiExportKey
    | PublicErrorTypeKey
    | "default"]: K extends "default" ? D : M[K];
};

export function buildPublicApiShape<M extends Record<string, unknown>, D>(
  moduleExports: M,
  defaultExport: D,
): PublicApiShape<M, D> {
  const shape: Record<string, unknown> = {};

  for (const key of PUBLIC_API_EXPORT_KEYS) {
    shape[key] = moduleExports[key];
  }
  for (const key of PUBLIC_ERROR_TYPE_KEYS) {
    shape[key] = moduleExports[key];
  }

  shape.default = defaultExport;

  return shape as PublicApiShape<M, D>;
}

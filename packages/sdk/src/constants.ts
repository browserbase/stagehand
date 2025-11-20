import type {
  AgentModelConfig,
  AgentProviderType,
  JsonSchema,
  JsonSchemaDocument,
  LogLevel,
  Logger,
  ModelProvider,
  StagehandZodObject,
  StagehandZodSchema,
} from "./types";
import { ZodSchemaValidationError } from "./errors";

class SchemaStub implements StagehandZodObject {
  public readonly kind = "stagehand-sdk-schema";

  constructor(public readonly shape: Record<string, unknown>) {}
}

const createSchemaStub = (shape: Record<string, unknown>) =>
  new SchemaStub(shape);

export const AnnotatedScreenshotText =
  "This is a screenshot of the current page state with the elements annotated on it. Each element id is annotated with a number to the top left of it. Duplicate annotations at the same location are under each other vertically.";

export const LOG_LEVEL_NAMES: Record<LogLevel, string> = Object.freeze({
  0: "error",
  1: "info",
  2: "debug",
});

export const AVAILABLE_CUA_MODELS: Record<string, AgentModelConfig> =
  Object.freeze({});

export const modelToAgentProviderMap: Record<string, AgentProviderType> =
  Object.freeze({});

export const providerEnvVarMap: Partial<
  Record<ModelProvider | string, string | Array<string>>
> = Object.freeze({});

export const defaultExtractSchema = createSchemaStub({
  extraction: "string",
});

export const pageTextSchema = createSchemaStub({
  pageText: "string",
});

export function getZodType(schema: StagehandZodSchema): string {
  return (schema as unknown as { _def?: { typeName?: string } })?._def?.typeName ?? "unknown";
}

export function transformSchema(
  schema: StagehandZodSchema,
  _currentPath: Array<string | number> = [],
): [StagehandZodSchema, Array<Array<string | number>>] {
  return [schema, []];
}

export function injectUrls(
  _obj: unknown,
  _path: Array<string | number>,
  _idToUrlMapping: Record<string, string>,
): void {}

export function trimTrailingTextNode(selector?: string): string | undefined {
  if (!selector) return selector;
  return selector.replace(/\/text\(\)\[\d+\]$/u, "");
}

export function validateZodSchema<T extends StagehandZodSchema>(schema: T): T {
  if (!schema) {
    throw new ZodSchemaValidationError("A schema instance is required");
  }
  return schema;
}

export function toGeminiSchema(schema: StagehandZodSchema): JsonSchemaDocument {
  return { schema };
}
export function toJsonSchema(schema: StagehandZodObject): JsonSchemaDocument {
  return { schema };
}

export function jsonSchemaToZod(_schema: JsonSchema): StagehandZodSchema {
  return createSchemaStub({});
}

export function loadApiKeyFromEnv(
  _provider: string | undefined,
  _logger: Logger,
): string | undefined {
  return undefined;
}

export function isRunningInBun(): boolean {
  return typeof (globalThis as { Bun?: unknown }).Bun !== "undefined";
}

export function isZod3Schema(_schema: unknown): _schema is StagehandZodSchema {
  return false;
}

export function isZod4Schema(_schema: unknown): _schema is StagehandZodSchema {
  return false;
}

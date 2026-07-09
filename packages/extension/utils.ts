import { ZodSchemaValidationError } from "./types/public/sdkErrors.js";
import { Schema, Type } from "@google/genai";
import { z } from "zod/v4";
import { LogLine } from "./types/public/logs.js";
import { ZodPathSegments } from "./types/private/internal.js";

const ID_PATTERN = /^\d+-\d+$/;

const TYPE_NAME_MAP: Record<string, string> = {
  string: "string",
  number: "number",
  boolean: "boolean",
  object: "object",
  array: "array",
  union: "union",
  intersection: "intersection",
  optional: "optional",
  nullable: "nullable",
  literal: "literal",
  enum: "enum",
  default: "default",
  pipe: "pipe",
};

function getZodDef(schema: z.ZodType) {
  return (schema as unknown as SchemaInternals)._zod?.def as Record<string, unknown> | undefined;
}

function getZodBag(schema: z.ZodType) {
  return (schema as unknown as SchemaInternals)._zod?.bag as Record<string, unknown> | undefined;
}

function getObjectShape(schema: z.ZodType): Record<string, z.ZodType> | undefined {
  return getZodDef(schema)?.shape as Record<string, z.ZodType> | undefined;
}

function getArrayElement(schema: z.ZodType): z.ZodType | undefined {
  return getZodDef(schema)?.element as z.ZodType | undefined;
}

function getInnerType(schema: z.ZodType): z.ZodType | undefined {
  return getZodDef(schema)?.innerType as z.ZodType | undefined;
}

function getUnionOptions(schema: z.ZodType): z.ZodType[] | undefined {
  const options = getZodDef(schema)?.options;
  return Array.isArray(options) ? (options as z.ZodType[]) : undefined;
}

function getIntersectionSides(schema: z.ZodType): {
  left?: z.ZodType;
  right?: z.ZodType;
} {
  const def = getZodDef(schema);
  return {
    left: def?.left as z.ZodType | undefined,
    right: def?.right as z.ZodType | undefined,
  };
}

function getEnumValues(schema: z.ZodType): string[] | undefined {
  const entries = getZodDef(schema)?.entries;
  if (entries && typeof entries === "object") {
    return Object.values(entries as Record<string, string>);
  }
  return undefined;
}

function getLiteralValues(schema: z.ZodType): unknown[] {
  const values = getZodDef(schema)?.values;
  if (Array.isArray(values)) {
    return values as unknown[];
  }
  if (values instanceof Set) {
    return Array.from(values);
  }
  return [];
}

function getStringChecks(schema: z.ZodType): unknown[] {
  const checks = getZodDef(schema)?.checks;
  return Array.isArray(checks) ? checks : [];
}

function getStringFormat(schema: z.ZodType): string | undefined {
  const bagFormat = getZodBag(schema)?.format;
  if (typeof bagFormat === "string") {
    return bagFormat;
  }
  const format = getZodDef(schema)?.format;
  if (typeof format === "string") {
    return format;
  }
  return undefined;
}

function getPipeEndpoints(schema: z.ZodType): {
  in?: z.ZodType;
  out?: z.ZodType;
} {
  const def = getZodDef(schema);
  if (def?.in || def?.out) {
    return {
      in: def?.in as z.ZodType | undefined,
      out: def?.out as z.ZodType | undefined,
    };
  }
  return {};
}

type SchemaInternals = {
  _zod?: { def?: Record<string, unknown>; bag?: Record<string, unknown> };
};

export function validateZodSchema(schema: z.ZodType, data: unknown) {
  const result = schema.safeParse(data);

  if (result.success) {
    return true;
  }
  throw new ZodSchemaValidationError(data, result.error.format());
}

/**
 * Strip a leading `provider/` segment from a model id, e.g.
 * "anthropic/claude-opus-4-8" -> "claude-opus-4-8". Ids without a
 * provider prefix pass through unchanged.
 */
export function stripModelProvider(modelId: string): string {
  return modelId.includes("/") ? modelId.slice(modelId.indexOf("/") + 1) : modelId;
}

/**
 * Detects if the code is running in the Bun runtime environment.
 * @returns {boolean} True if running in Bun, false otherwise.
 */
export function isRunningInBun(): boolean {
  return (
    typeof process !== "undefined" &&
    typeof process.versions !== "undefined" &&
    "bun" in process.versions
  );
}

/*
 * Helper functions for converting between Gemini and Zod schemas
 */
function decorateGeminiSchema(geminiSchema: Schema, zodSchema: z.ZodType): Schema {
  if (geminiSchema.nullable === undefined) {
    geminiSchema.nullable = zodSchema.isOptional();
  }

  if (zodSchema.description) {
    geminiSchema.description = zodSchema.description;
  }

  return geminiSchema;
}

export function toGeminiSchema(zodSchema: z.ZodType): Schema {
  const zodType = getZodType(zodSchema);
  switch (zodType) {
    case "array": {
      const element = getArrayElement(zodSchema) ?? z.any();
      return decorateGeminiSchema(
        {
          type: Type.ARRAY,
          items: toGeminiSchema(element),
        },
        zodSchema,
      );
    }
    case "object": {
      const properties: Record<string, Schema> = {};
      const required: string[] = [];

      const shape = getObjectShape(zodSchema);
      if (shape) {
        Object.entries(shape).forEach(([key, value]: [string, z.ZodType]) => {
          properties[key] = toGeminiSchema(value);
          if (getZodType(value) !== "optional") {
            required.push(key);
          }
        });
      }

      return decorateGeminiSchema(
        {
          type: Type.OBJECT,
          properties,
          required: required.length > 0 ? required : undefined,
        },
        zodSchema,
      );
    }
    case "string":
      return decorateGeminiSchema(
        {
          type: Type.STRING,
        },
        zodSchema,
      );
    case "number":
      return decorateGeminiSchema(
        {
          type: Type.NUMBER,
        },
        zodSchema,
      );
    case "boolean":
      return decorateGeminiSchema(
        {
          type: Type.BOOLEAN,
        },
        zodSchema,
      );
    case "enum": {
      const values = getEnumValues(zodSchema);
      return decorateGeminiSchema(
        {
          type: Type.STRING,
          enum: values,
        },
        zodSchema,
      );
    }
    case "default":
    case "nullable":
    case "optional": {
      const innerType = getInnerType(zodSchema) ?? z.any();
      const innerSchema = toGeminiSchema(innerType);
      return decorateGeminiSchema(
        {
          ...innerSchema,
          nullable: true,
        },
        zodSchema,
      );
    }
    case "literal": {
      const values = getLiteralValues(zodSchema);
      return decorateGeminiSchema(
        {
          type: Type.STRING,
          enum: values as string[],
        },
        zodSchema,
      );
    }
    case "pipe": {
      const endpoints = getPipeEndpoints(zodSchema);
      if (endpoints.in) {
        return toGeminiSchema(endpoints.in);
      }
      return decorateGeminiSchema(
        {
          type: Type.STRING,
        },
        zodSchema,
      );
    }
    // Standalone transforms and any unknown types fall through to default
    default:
      return decorateGeminiSchema(
        {
          type: Type.STRING,
        },
        zodSchema,
      );
  }
}

// Helper function to check the type of Zod schema
export function getZodType(schema: z.ZodType): string {
  const schemaWithDef = schema as unknown as SchemaInternals & {
    _zod?: { def?: { type?: string } };
  };
  const rawType = schemaWithDef._zod?.def?.type as string | undefined;

  if (!rawType) {
    return "unknown";
  }

  return TYPE_NAME_MAP[rawType] ?? rawType;
}

/**
 * Recursively traverses a given Zod schema, scanning for any fields of type `z.string().url()`.
 * For each such field, it replaces the `z.string().url()` with `z.number()`.
 *
 * This function is used internally by higher-level utilities (e.g., transforming entire object schemas)
 * and handles nested objects, arrays, unions, intersections, optionals.
 *
 * @param schema - The Zod schema to transform.
 * @param currentPath - An array of string/number keys representing the current schema path (used internally for recursion).
 * @returns A two-element tuple:
 *   1. The updated Zod schema, with any `.url()` fields replaced by `z.number()`.
 *   2. An array of {@link ZodPathSegments} objects representing each replaced field, including the path segments.
 */
export function transformSchema(
  schema: z.ZodType,
  currentPath: Array<string | number>,
): [z.ZodType, ZodPathSegments[]] {
  if (isKind(schema, "string")) {
    const checks = getStringChecks(schema);
    const format = getStringFormat(schema);
    const hasUrlCheck =
      checks.some((check) => {
        const candidate = check as {
          kind?: string;
          format?: string;
          _zod?: { def?: { check?: string; format?: string } };
        };
        return (
          candidate.kind === "url" ||
          candidate.format === "url" ||
          candidate._zod?.def?.check === "url" ||
          candidate._zod?.def?.format === "url"
        );
      }) || format === "url";

    if (hasUrlCheck) {
      return [makeIdStringSchema(schema), [{ segments: [] }]];
    }
    return [schema, []];
  }

  if (isKind(schema, "object")) {
    const shape = getObjectShape(schema);
    if (!shape) {
      return [schema, []];
    }
    const newShape: Record<string, z.ZodType> = {};
    const urlPaths: ZodPathSegments[] = [];
    let changed = false;

    for (const key of Object.keys(shape)) {
      const child = shape[key];
      const [transformedChild, childPaths] = transformSchema(child, [...currentPath, key]);
      if (transformedChild !== child) {
        changed = true;
      }
      newShape[key] = transformedChild;
      childPaths.forEach((cp) => {
        urlPaths.push({ segments: [key, ...cp.segments] });
      });
    }

    if (changed) {
      return [z.object(newShape), urlPaths];
    }
    return [schema, urlPaths];
  }

  if (isKind(schema, "array")) {
    const itemType = getArrayElement(schema);
    if (!itemType) {
      return [schema, []];
    }
    const [transformedItem, childPaths] = transformSchema(itemType, [...currentPath, "*"]);
    const arrayPaths: ZodPathSegments[] = childPaths.map((cp) => ({
      segments: ["*", ...cp.segments],
    }));
    if (transformedItem !== itemType) {
      return [z.array(transformedItem), arrayPaths];
    }
    return [schema, arrayPaths];
  }

  if (isKind(schema, "union")) {
    const unionOptions = getUnionOptions(schema);
    if (!unionOptions || unionOptions.length === 0) {
      return [schema, []];
    }
    const newOptions: z.ZodType[] = [];
    let changed = false;
    let allPaths: ZodPathSegments[] = [];

    unionOptions.forEach((option, idx) => {
      const [newOption, childPaths] = transformSchema(option, [...currentPath, `union_${idx}`]);
      if (newOption !== option) {
        changed = true;
      }
      newOptions.push(newOption);
      allPaths = [...allPaths, ...childPaths];
    });

    if (changed) {
      return [z.union(newOptions as unknown as [z.ZodType, z.ZodType, ...z.ZodType[]]), allPaths];
    }
    return [schema, allPaths];
  }

  if (isKind(schema, "intersection")) {
    const { left, right } = getIntersectionSides(schema);
    if (!left || !right) {
      return [schema, []];
    }
    const [newLeft, leftPaths] = transformSchema(left, [...currentPath, "intersection_left"]);
    const [newRight, rightPaths] = transformSchema(right, [...currentPath, "intersection_right"]);
    const changed = newLeft !== left || newRight !== right;
    const allPaths = [...leftPaths, ...rightPaths];
    if (changed) {
      return [z.intersection(newLeft, newRight), allPaths];
    }
    return [schema, allPaths];
  }

  if (isKind(schema, "optional")) {
    const innerType = getInnerType(schema);
    if (!innerType) {
      return [schema, []];
    }
    const [inner, innerPaths] = transformSchema(innerType, currentPath);
    if (inner !== innerType) {
      return [inner.optional(), innerPaths];
    }
    return [schema, innerPaths];
  }

  if (isKind(schema, "nullable")) {
    const innerType = getInnerType(schema);
    if (!innerType) {
      return [schema, []];
    }
    const [inner, innerPaths] = transformSchema(innerType, currentPath);
    if (inner !== innerType) {
      return [inner.nullable(), innerPaths];
    }
    return [schema, innerPaths];
  }

  if (isKind(schema, "pipe")) {
    const { in: inSchema, out: outSchema } = getPipeEndpoints(schema);
    if (!inSchema || !outSchema) {
      return [schema, []];
    }

    const [newIn, inPaths] = transformSchema(inSchema, currentPath);
    const [newOut, outPaths] = transformSchema(outSchema, currentPath);
    const allPaths = [...inPaths, ...outPaths];

    if (newIn !== inSchema || newOut !== outSchema) {
      const result = z.pipe(newIn as z.ZodType, newOut as z.ZodType) as z.ZodType;
      return [result, allPaths];
    }
    return [schema, allPaths];
  }

  return [schema, []];
}

/**
 * Once we get the final extracted object that has numeric IDs in place of URLs,
 * use `injectUrls` to walk the object and replace numeric IDs
 * with the real URL strings from idToUrlMapping. The `path` may include `*`
 * for array indices (indicating "all items in the array").
 */
export function injectUrls(
  obj: unknown,
  path: Array<string | number>,
  idToUrlMapping: Record<string, string>,
): void {
  if (path.length === 0) return;
  const toId = (value: unknown): string | undefined => {
    if (typeof value === "number") {
      return String(value);
    }
    if (typeof value === "string" && ID_PATTERN.test(value)) {
      return value;
    }
    return undefined;
  };
  const [key, ...rest] = path;

  if (key === "*") {
    if (Array.isArray(obj)) {
      if (rest.length === 0) {
        for (let i = 0; i < obj.length; i += 1) {
          const id = toId(obj[i]);
          if (id !== undefined) {
            obj[i] = idToUrlMapping[id] ?? "";
          }
        }
      } else {
        for (const item of obj) injectUrls(item, rest, idToUrlMapping);
      }
    }
    return;
  }

  if (obj && typeof obj === "object") {
    const record = obj as Record<string | number, unknown>;
    if (path.length === 1) {
      const fieldValue = record[key];
      const id = toId(fieldValue);
      if (id !== undefined) {
        record[key] = idToUrlMapping[id] ?? "";
      }
    } else {
      injectUrls(record[key], rest, idToUrlMapping);
    }
  }
}

// Helper to check if a schema is of a specific type
function isKind(s: z.ZodType, kind: string): boolean {
  try {
    return getZodType(s) === kind;
  } catch {
    return false;
  }
}

function makeIdStringSchema(orig: z.ZodType): z.ZodType {
  const userDesc = (orig as unknown as { description?: string }).description ?? "";

  const base =
    "This field must be the element-ID in the form 'frameId-backendId' " + '(e.g. "0-432").';
  const composed =
    userDesc.trim().length > 0
      ? `${base} that follows this user-defined description: ${userDesc}`
      : base;

  return z.string().regex(ID_PATTERN).describe(composed);
}

/**
 * Mapping from LLM provider names to their corresponding environment variable names for API keys.
 */
export const providerEnvVarMap: Partial<Record<string, string | Array<string>>> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  google: ["GEMINI_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY", "GOOGLE_API_KEY"],
  vertex: "GOOGLE_VERTEX_AI_API_KEY",
  groq: "GROQ_API_KEY",
  cerebras: "CEREBRAS_API_KEY",
  togetherai: "TOGETHER_AI_API_KEY",
  mistral: "MISTRAL_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  perplexity: "PERPLEXITY_API_KEY",
  azure: "AZURE_API_KEY",
  xai: "XAI_API_KEY",
  google_legacy: "GOOGLE_API_KEY",
};

const providersWithoutApiKey = new Set(["bedrock", "ollama"]);

/**
 * Loads an API key for a provider, checking environment variables.
 * @param provider The name of the provider (e.g., 'openai', 'anthropic')
 * @param logger Optional logger for info/error messages
 * @returns The API key if found, undefined otherwise
 */
export function loadApiKeyFromEnv(
  provider: string | undefined,
  logger: (logLine: LogLine) => void,
): string | undefined {
  if (!provider) {
    return undefined;
  }

  const envVarName = providerEnvVarMap[provider];
  if (!envVarName) {
    if (!providersWithoutApiKey.has(provider)) {
      logger({
        category: "init",
        message: `No known environment variable for provider '${provider}'`,
        level: 0,
      });
    }
    return undefined;
  }

  const apiKeyFromEnv = Array.isArray(envVarName)
    ? envVarName.map((name) => process.env[name]).find((key) => key && key.length > 0)
    : process.env[envVarName as string];
  if (typeof apiKeyFromEnv === "string" && apiKeyFromEnv.length > 0) {
    return apiKeyFromEnv;
  }

  // Don't log - this is expected when llmClient is provided or API key will be set later
  return undefined;
}

export function hasModelProviderAuth(clientOptions: unknown): boolean {
  if (!clientOptions || typeof clientOptions !== "object") {
    return false;
  }

  const auth = (clientOptions as { auth?: unknown }).auth;
  return auth !== undefined && auth !== null;
}

export function getInheritableModelOptions<T extends object>(
  clientOptions: T | undefined,
): Partial<T> | undefined {
  if (!clientOptions) {
    return undefined;
  }

  const inheritableOptions = {
    ...(clientOptions as Record<string, unknown>),
  };
  delete inheritableOptions.apiKey;
  delete inheritableOptions.auth;

  return inheritableOptions as Partial<T>;
}

export function trimTrailingTextNode(path: string | undefined): string | undefined {
  return path?.replace(/\/text\(\)(\[\d+\])?$/iu, "");
}

export function toTitleCase(str: string): string {
  return str.replace(/\w\S*/g, (text) => text.charAt(0).toUpperCase() + text.substring(1));
}

// TODO: move to separate types file
export interface JsonSchemaProperty {
  type: string;
  enum?: unknown[];
  items?: JsonSchemaProperty;
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
  minimum?: number;
  maximum?: number;
  description?: string;
  format?: string; // JSON Schema format field (e.g., "uri", "url", "email", etc.)
}
export interface JsonSchema extends JsonSchemaProperty {
  type: string;
}

/**
 * Converts a JSON Schema object to a Zod schema
 * @param schema The JSON Schema object to convert
 * @returns A Zod schema equivalent to the input JSON Schema
 */
export function jsonSchemaToZod(schema: JsonSchema): z.ZodType {
  switch (schema.type) {
    case "object":
      if (schema.properties) {
        const shape: Record<string, z.ZodType> = {};
        for (const key in schema.properties) {
          shape[key] = jsonSchemaToZod(schema.properties[key]);
        }
        let zodObject = z.object(shape);
        if (schema.required && Array.isArray(schema.required)) {
          const requiredFields = schema.required.reduce<Record<string, true>>(
            (acc, field) => ({ ...acc, [field]: true }),
            {},
          );
          zodObject = zodObject.partial().required(requiredFields);
        }
        if (schema.description) {
          zodObject = zodObject.describe(schema.description);
        }
        return zodObject;
      } else {
        return z.object({});
      }
    case "array":
      if (schema.items) {
        let zodArray = z.array(jsonSchemaToZod(schema.items));
        if (schema.description) {
          zodArray = zodArray.describe(schema.description);
        }
        return zodArray;
      } else {
        return z.array(z.any());
      }
    case "string": {
      if (schema.enum) {
        return z.string().refine((val) => schema.enum!.includes(val));
      }
      let zodString = z.string();

      // Handle JSON Schema format field
      if (schema.format === "uri" || schema.format === "url") {
        zodString = zodString.url();
      } else if (schema.format === "email") {
        zodString = zodString.email();
      } else if (schema.format === "uuid") {
        zodString = zodString.uuid();
      }
      // Add more format handlers as needed

      if (schema.description) {
        zodString = zodString.describe(schema.description);
      }
      return zodString;
    }
    case "number": {
      let zodNumber = z.number();
      if (schema.minimum !== undefined) {
        zodNumber = zodNumber.min(schema.minimum);
      }
      if (schema.maximum !== undefined) {
        zodNumber = zodNumber.max(schema.maximum);
      }
      if (schema.description) {
        zodNumber = zodNumber.describe(schema.description);
      }
      return zodNumber;
    }
    case "boolean": {
      let zodBoolean = z.boolean();
      if (schema.description) {
        zodBoolean = zodBoolean.describe(schema.description);
      }
      return zodBoolean;
    }
    default:
      return z.any();
  }
}

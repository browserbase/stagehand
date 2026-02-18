import { ZodSchemaValidationError } from "./v3/types/public/sdkErrors.js";
import { Schema, Type } from "@google/genai";
import { z, ZodTypeAny } from "zod";
import z3 from "zod/v3";
import { LogLine } from "./v3/types/public/logs.js";
import { ModelProvider } from "./v3/types/public/model.js";
import { ZodPathSegments } from "./v3/types/private/internal.js";
import type { StagehandZodSchema } from "./v3/zodCompat.js";
import { isZod4Schema } from "./v3/zodCompat.js";

const ID_PATTERN = /^\d+-\d+$/;

const zFactories = {
  v4: z,
  v3: z3 as unknown as typeof z,
};

export function getZFactory(schema: StagehandZodSchema): typeof z {
  return isZod4Schema(schema) ? zFactories.v4 : zFactories.v3;
}

const TYPE_NAME_MAP: Record<string, string> = {
  ZodString: "string",
  string: "string",
  ZodNumber: "number",
  number: "number",
  ZodBoolean: "boolean",
  boolean: "boolean",
  ZodObject: "object",
  object: "object",
  ZodArray: "array",
  array: "array",
  ZodUnion: "union",
  union: "union",
  ZodIntersection: "intersection",
  intersection: "intersection",
  ZodOptional: "optional",
  optional: "optional",
  ZodNullable: "nullable",
  nullable: "nullable",
  ZodLiteral: "literal",
  literal: "literal",
  ZodEnum: "enum",
  enum: "enum",
  ZodDefault: "default",
  default: "default",
  ZodEffects: "effects",
  effects: "effects",
  pipe: "pipe",
};

function getZ4Def(schema: StagehandZodSchema) {
  return (schema as SchemaInternals)._zod?.def as
    | Record<string, unknown>
    | undefined;
}

function getZ4Bag(schema: StagehandZodSchema) {
  return (schema as SchemaInternals)._zod?.bag as
    | Record<string, unknown>
    | undefined;
}

function getZ3Def(schema: StagehandZodSchema) {
  return (schema as SchemaInternals)._def as
    | Record<string, unknown>
    | undefined;
}

function getObjectShape(
  schema: StagehandZodSchema,
): Record<string, StagehandZodSchema> | undefined {
  const z4Shape = getZ4Def(schema)?.shape as
    | Record<string, StagehandZodSchema>
    | undefined;
  if (z4Shape) {
    return z4Shape;
  }

  const z3Shape = getZ3Def(schema)?.shape;
  if (!z3Shape) {
    return undefined;
  }

  if (typeof z3Shape === "function") {
    return (z3Shape as () => Record<string, StagehandZodSchema>)();
  }

  return z3Shape as Record<string, StagehandZodSchema>;
}

function getArrayElement(
  schema: StagehandZodSchema,
): StagehandZodSchema | undefined {
  return (getZ4Def(schema)?.element ?? getZ3Def(schema)?.type) as
    | StagehandZodSchema
    | undefined;
}

function getInnerType(
  schema: StagehandZodSchema,
): StagehandZodSchema | undefined {
  return (getZ4Def(schema)?.innerType ?? getZ3Def(schema)?.innerType) as
    | StagehandZodSchema
    | undefined;
}

function getUnionOptions(
  schema: StagehandZodSchema,
): StagehandZodSchema[] | undefined {
  const z4Options = getZ4Def(schema)?.options;
  if (Array.isArray(z4Options)) {
    return z4Options as StagehandZodSchema[];
  }
  const z3Options = getZ3Def(schema)?.options;
  return Array.isArray(z3Options)
    ? (z3Options as StagehandZodSchema[])
    : undefined;
}

function getIntersectionSides(schema: StagehandZodSchema): {
  left?: StagehandZodSchema;
  right?: StagehandZodSchema;
} {
  const z4Def = getZ4Def(schema);
  if (z4Def?.left || z4Def?.right) {
    return {
      left: z4Def?.left as StagehandZodSchema | undefined,
      right: z4Def?.right as StagehandZodSchema | undefined,
    };
  }
  const z3Def = getZ3Def(schema);
  return {
    left: z3Def?.left as StagehandZodSchema | undefined,
    right: z3Def?.right as StagehandZodSchema | undefined,
  };
}

function getEnumValues(schema: StagehandZodSchema): string[] | undefined {
  const z4Entries = getZ4Def(schema)?.entries;
  if (z4Entries && typeof z4Entries === "object") {
    return Object.values(z4Entries as Record<string, string>);
  }
  const z3Values = getZ3Def(schema)?.values;
  return Array.isArray(z3Values) ? (z3Values as string[]) : undefined;
}

function getLiteralValues(schema: StagehandZodSchema): unknown[] {
  const z4Values = getZ4Def(schema)?.values;
  if (Array.isArray(z4Values)) {
    return z4Values as unknown[];
  }
  const value = getZ3Def(schema)?.value;
  return typeof value !== "undefined" ? [value] : [];
}

function getStringChecks(schema: StagehandZodSchema): unknown[] {
  const z4Checks = getZ4Def(schema)?.checks;
  if (Array.isArray(z4Checks)) {
    return z4Checks;
  }
  const z3Checks = getZ3Def(schema)?.checks;
  return Array.isArray(z3Checks) ? z3Checks : [];
}

function getStringFormat(schema: StagehandZodSchema): string | undefined {
  const bagFormat = getZ4Bag(schema)?.format;
  if (typeof bagFormat === "string") {
    return bagFormat;
  }
  const z4Format = getZ4Def(schema)?.format;
  if (typeof z4Format === "string") {
    return z4Format;
  }
  const z3Format = getZ3Def(schema)?.format;
  return typeof z3Format === "string" ? z3Format : undefined;
}

function getPipeEndpoints(schema: StagehandZodSchema): {
  in?: StagehandZodSchema;
  out?: StagehandZodSchema;
} {
  const z4Def = getZ4Def(schema);
  if (z4Def?.in || z4Def?.out) {
    return {
      in: z4Def?.in as StagehandZodSchema | undefined,
      out: z4Def?.out as StagehandZodSchema | undefined,
    };
  }
  return {};
}

function getEffectsBaseSchema(
  schema: StagehandZodSchema,
): StagehandZodSchema | undefined {
  return getZ3Def(schema)?.schema as StagehandZodSchema | undefined;
}

type SchemaInternals = {
  _zod?: { def?: Record<string, unknown>; bag?: Record<string, unknown> };
  _def?: Record<string, unknown>;
};

export function validateZodSchema(schema: StagehandZodSchema, data: unknown) {
  const result = schema.safeParse(data);

  if (result.success) {
    return true;
  }
  throw new ZodSchemaValidationError(data, result.error.format());
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
function decorateGeminiSchema(
  geminiSchema: Schema,
  zodSchema: z.ZodTypeAny,
): Schema {
  if (geminiSchema.nullable === undefined) {
    geminiSchema.nullable = zodSchema.isOptional();
  }

  if (zodSchema.description) {
    geminiSchema.description = zodSchema.description;
  }

  return geminiSchema;
}

export function toGeminiSchema(zodSchema: StagehandZodSchema): Schema {
  const normalizedSchema = zodSchema as z.ZodTypeAny;
  const zodType = getZodType(zodSchema);
  switch (zodType) {
    case "array": {
      const element = getArrayElement(zodSchema) ?? z.any();
      return decorateGeminiSchema(
        {
          type: Type.ARRAY,
          items: toGeminiSchema(element),
        },
        normalizedSchema,
      );
    }
    case "object": {
      const properties: Record<string, Schema> = {};
      const required: string[] = [];

      const shape = getObjectShape(zodSchema);
      if (shape) {
        Object.entries(shape).forEach(
          ([key, value]: [string, StagehandZodSchema]) => {
            properties[key] = toGeminiSchema(value);
            if (getZodType(value) !== "optional") {
              required.push(key);
            }
          },
        );
      }

      return decorateGeminiSchema(
        {
          type: Type.OBJECT,
          properties,
          required: required.length > 0 ? required : undefined,
        },
        normalizedSchema,
      );
    }
    case "string":
      return decorateGeminiSchema(
        {
          type: Type.STRING,
        },
        normalizedSchema,
      );
    case "number":
      return decorateGeminiSchema(
        {
          type: Type.NUMBER,
        },
        normalizedSchema,
      );
    case "boolean":
      return decorateGeminiSchema(
        {
          type: Type.BOOLEAN,
        },
        normalizedSchema,
      );
    case "enum": {
      const values = getEnumValues(zodSchema);
      return decorateGeminiSchema(
        {
          type: Type.STRING,
          enum: values,
        },
        normalizedSchema,
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
        normalizedSchema,
      );
    }
    case "literal": {
      const values = getLiteralValues(zodSchema);
      return decorateGeminiSchema(
        {
          type: Type.STRING,
          enum: values as string[],
        },
        normalizedSchema,
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
        normalizedSchema,
      );
    }
    // Standalone transforms and any unknown types fall through to default
    default:
      return decorateGeminiSchema(
        {
          type: Type.STRING,
        },
        normalizedSchema,
      );
  }
}

// Helper function to check the type of Zod schema
export function getZodType(schema: StagehandZodSchema): string {
  const schemaWithDef = schema as SchemaInternals & {
    _zod?: { def?: { type?: string } };
  };
  const rawType =
    (schemaWithDef._zod?.def?.type as string | undefined) ??
    (schemaWithDef._def?.typeName as string | undefined) ??
    (schemaWithDef._def?.type as string | undefined);

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
  schema: StagehandZodSchema,
  currentPath: Array<string | number>,
): [StagehandZodSchema, ZodPathSegments[]] {
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
    const newShape: Record<string, StagehandZodSchema> = {};
    const urlPaths: ZodPathSegments[] = [];
    let changed = false;

    for (const key of Object.keys(shape)) {
      const child = shape[key];
      const [transformedChild, childPaths] = transformSchema(child, [
        ...currentPath,
        key,
      ]);
      if (transformedChild !== child) {
        changed = true;
      }
      newShape[key] = transformedChild;
      childPaths.forEach((cp) => {
        urlPaths.push({ segments: [key, ...cp.segments] });
      });
    }

    if (changed) {
      const factory = getZFactory(schema);
      return [
        factory.object(newShape as Record<string, z.ZodTypeAny>),
        urlPaths,
      ];
    }
    return [schema, urlPaths];
  }

  if (isKind(schema, "array")) {
    const itemType = getArrayElement(schema);
    if (!itemType) {
      return [schema, []];
    }
    const [transformedItem, childPaths] = transformSchema(itemType, [
      ...currentPath,
      "*",
    ]);
    const arrayPaths: ZodPathSegments[] = childPaths.map((cp) => ({
      segments: ["*", ...cp.segments],
    }));
    if (transformedItem !== itemType) {
      const factory = getZFactory(schema);
      return [
        factory.array(transformedItem as unknown as z.ZodTypeAny),
        arrayPaths,
      ];
    }
    return [schema, arrayPaths];
  }

  if (isKind(schema, "union")) {
    const unionOptions = getUnionOptions(schema);
    if (!unionOptions || unionOptions.length === 0) {
      return [schema, []];
    }
    const newOptions: StagehandZodSchema[] = [];
    let changed = false;
    let allPaths: ZodPathSegments[] = [];

    unionOptions.forEach((option, idx) => {
      const [newOption, childPaths] = transformSchema(option, [
        ...currentPath,
        `union_${idx}`,
      ]);
      if (newOption !== option) {
        changed = true;
      }
      newOptions.push(newOption);
      allPaths = [...allPaths, ...childPaths];
    });

    if (changed) {
      const factory = getZFactory(schema);
      return [
        factory.union(
          newOptions as unknown as [
            z.ZodTypeAny,
            z.ZodTypeAny,
            ...z.ZodTypeAny[],
          ],
        ),
        allPaths,
      ];
    }
    return [schema, allPaths];
  }

  if (isKind(schema, "intersection")) {
    const { left, right } = getIntersectionSides(schema);
    if (!left || !right) {
      return [schema, []];
    }
    const [newLeft, leftPaths] = transformSchema(left, [
      ...currentPath,
      "intersection_left",
    ]);
    const [newRight, rightPaths] = transformSchema(right, [
      ...currentPath,
      "intersection_right",
    ]);
    const changed = newLeft !== left || newRight !== right;
    const allPaths = [...leftPaths, ...rightPaths];
    if (changed) {
      const factory = getZFactory(schema);
      return [
        factory.intersection(
          newLeft as unknown as z.ZodTypeAny,
          newRight as unknown as z.ZodTypeAny,
        ),
        allPaths,
      ];
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
      return [
        (inner as z.ZodTypeAny).optional() as unknown as StagehandZodSchema,
        innerPaths,
      ];
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
      return [
        (inner as z.ZodTypeAny).nullable() as unknown as StagehandZodSchema,
        innerPaths,
      ];
    }
    return [schema, innerPaths];
  }

  if (isKind(schema, "pipe") && isZod4Schema(schema)) {
    const { in: inSchema, out: outSchema } = getPipeEndpoints(schema);
    if (!inSchema || !outSchema) {
      return [schema, []];
    }

    const [newIn, inPaths] = transformSchema(inSchema, currentPath);
    const [newOut, outPaths] = transformSchema(outSchema, currentPath);
    const allPaths = [...inPaths, ...outPaths];

    if (newIn !== inSchema || newOut !== outSchema) {
      const result = z.pipe(
        newIn as unknown as z.ZodTypeAny,
        newOut as unknown as z.ZodTypeAny,
      ) as StagehandZodSchema;
      return [result, allPaths];
    }
    return [schema, allPaths];
  }

  if (isKind(schema, "effects")) {
    const baseSchema = getEffectsBaseSchema(schema);
    if (!baseSchema) {
      return [schema, []];
    }
    return transformSchema(baseSchema, currentPath);
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
function isKind(s: StagehandZodSchema, kind: string): boolean {
  try {
    return getZodType(s) === kind;
  } catch {
    return false;
  }
}

function makeIdStringSchema(orig: StagehandZodSchema): StagehandZodSchema {
  const userDesc =
    (orig as unknown as { description?: string }).description ?? "";

  const base =
    "This field must be the element-ID in the form 'frameId-backendId' " +
    '(e.g. "0-432").';
  const composed =
    userDesc.trim().length > 0
      ? `${base} that follows this user-defined description: ${userDesc}`
      : base;

  const factory = getZFactory(orig);
  return factory.string().regex(ID_PATTERN).describe(composed);
}

/**
 * Mapping from LLM provider names to their corresponding environment variable names for API keys.
 */
export const providerEnvVarMap: Partial<
  Record<ModelProvider | string, string | Array<string>>
> = {
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
    ? envVarName
        .map((name) => process.env[name])
        .find((key) => key && key.length > 0)
    : process.env[envVarName as string];
  if (typeof apiKeyFromEnv === "string" && apiKeyFromEnv.length > 0) {
    return apiKeyFromEnv;
  }

  // Don't log - this is expected when llmClient is provided or API key will be set later
  return undefined;
}

export function trimTrailingTextNode(
  path: string | undefined,
): string | undefined {
  return path?.replace(/\/text\(\)(\[\d+\])?$/iu, "");
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
export function jsonSchemaToZod(schema: JsonSchema): ZodTypeAny {
  switch (schema.type) {
    case "object":
      if (schema.properties) {
        const shape: Record<string, ZodTypeAny> = {};
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

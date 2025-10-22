import { ZodSchemaValidationError } from "./v3/types/public/sdkErrors";
import { Schema, Type } from "@google/genai";
import { z, ZodTypeAny } from "zod";
import { LogLine } from "./v3/types/public/logs";
import { ModelProvider } from "./v3/types/public/model";
import { ZodPathSegments } from "./v3/types/private/internal";

/**
 * Zod 4 Internal Types
 *
 * We import these from zod/v4/core to access the internal structure of Zod schemas.
 * Note: zod/v4/core uses `$ZodType` while the main zod module uses `z.ZodTypeAny`.
 * These are functionally identical at runtime but TypeScript sees them as incompatible types.
 * Therefore, when extracting properties from these internals (e.g., `def.element`, `def.innerType`),
 * we must cast them to `z.ZodTypeAny` to work with the public Zod API.
 */
import type {
  $ZodArrayInternals,
  $ZodObjectInternals,
  $ZodStringInternals,
  $ZodUnionInternals,
  $ZodIntersectionInternals,
  $ZodOptionalInternals,
  $ZodNullableInternals,
  $ZodPipeInternals,
  $ZodEnumInternals,
  $ZodLiteralInternals,
} from "zod/v4/core";

const ID_PATTERN = /^\d+-\d+$/;

// Helper type for accessing Zod 4 internals
type ZodWithInternals<T> = z.ZodTypeAny & { _zod: T };

export function validateZodSchema(schema: z.ZodTypeAny, data: unknown) {
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

export function toGeminiSchema(zodSchema: z.ZodTypeAny): Schema {
  let zodType: string;
  try {
    zodType = getZodType(zodSchema);
  } catch (error) {
    console.error("Error getting Zod type:", error);
    console.error("Schema object keys:", Object.keys(zodSchema));
    console.error("Schema:", zodSchema);
    throw error;
  }

  switch (zodType) {
    case "array": {
      const arraySchema = zodSchema as ZodWithInternals<$ZodArrayInternals>;
      const element = arraySchema._zod.def.element as z.ZodTypeAny;
      return decorateGeminiSchema(
        {
          type: Type.ARRAY,
          items: toGeminiSchema(element ?? z.any()),
        },
        zodSchema,
      );
    }
    case "object": {
      const properties: Record<string, Schema> = {};
      const required: string[] = [];

      const objectSchema = zodSchema as ZodWithInternals<$ZodObjectInternals>;
      const shape = objectSchema._zod.def.shape;
      Object.entries(shape).forEach(([key, value]: [string, z.ZodTypeAny]) => {
        properties[key] = toGeminiSchema(value);
        if (getZodType(value) !== "optional") {
          required.push(key);
        }
      });

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
    case "url":
      // URL type in Zod 4 is still a string at the schema level
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
      const enumSchema = zodSchema as ZodWithInternals<$ZodEnumInternals>;
      const values = Object.values(enumSchema._zod.def.entries);
      return decorateGeminiSchema(
        {
          type: Type.STRING,
          enum: values as string[],
        },
        zodSchema,
      );
    }
    case "default":
    case "nullable":
    case "optional": {
      const wrapperSchema = zodSchema as ZodWithInternals<
        $ZodOptionalInternals | $ZodNullableInternals
      >;
      const innerType = wrapperSchema._zod.def.innerType as z.ZodTypeAny;
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
      const literalSchema = zodSchema as ZodWithInternals<$ZodLiteralInternals>;
      const values = literalSchema._zod.def.values;
      return decorateGeminiSchema(
        {
          type: Type.STRING,
          enum: values as string[],
        },
        zodSchema,
      );
    }
    case "pipe": {
      const pipeSchema = zodSchema as ZodWithInternals<$ZodPipeInternals>;
      const inSchema = pipeSchema._zod.def.in as z.ZodTypeAny;
      return toGeminiSchema(inSchema);
    }
    // Standalone transforms and any unknown types fall through to default
    default:
      return decorateGeminiSchema(
        {
          type: Type.OBJECT,
          nullable: true,
        },
        zodSchema,
      );
  }
}

// Helper function to check the type of Zod schema
export function getZodType(schema: z.ZodTypeAny): string {
  // In Zod 4, the type is accessed via _zod.def.type
  const schemaWithDef = schema as unknown as {
    _zod?: { def?: { type?: string } };
  };

  if (schemaWithDef._zod?.def?.type) {
    return schemaWithDef._zod.def.type;
  }

  throw new Error(
    `Unable to determine Zod schema type. Schema: ${JSON.stringify(schema)}`,
  );
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
  schema: z.ZodTypeAny,
  currentPath: Array<string | number>,
): [z.ZodTypeAny, ZodPathSegments[]] {
  // 1) If it's a URL type (z.url() in Zod 4), convert to ID string pattern
  if (isKind(schema, "url")) {
    const transformed = makeIdStringSchema(schema as z.ZodString);
    console.log("[transformSchema] Found URL type, transforming to ID pattern");
    console.log("[transformSchema] Original schema type:", getZodType(schema));
    console.log(
      "[transformSchema] Transformed schema type:",
      getZodType(transformed),
    );
    return [transformed, [{ segments: [] }]];
  }

  // 2) If it's a string with .url() check, convert to ID string pattern
  if (isKind(schema, "string")) {
    const stringSchema = schema as ZodWithInternals<
      $ZodStringInternals<unknown>
    >;
    const checks = stringSchema._zod.def.checks;
    const format = stringSchema._zod.bag?.format;
    const hasUrlCheck =
      (checks?.some((check) => check._zod?.def?.check === "url") ?? false) ||
      format === "url";
    if (hasUrlCheck) {
      return [makeIdStringSchema(schema as z.ZodString), [{ segments: [] }]];
    }
    return [schema, []];
  }

  // 3) If it's an object, transform each field
  if (isKind(schema, "object")) {
    const objectSchema = schema as ZodWithInternals<$ZodObjectInternals>;
    const shape = objectSchema._zod.def.shape as Record<string, z.ZodTypeAny>;
    if (!shape) {
      return [schema, []];
    }
    const newShape: Record<string, z.ZodTypeAny> = {};
    const urlPaths: ZodPathSegments[] = [];
    let changed = false;

    const shapeKeys = Object.keys(shape);

    for (const key of shapeKeys) {
      const child = shape[key];
      const [transformedChild, childPaths] = transformSchema(child, [
        ...currentPath,
        key,
      ]);

      if (transformedChild !== child) {
        changed = true;
      }
      newShape[key] = transformedChild;

      if (childPaths.length > 0) {
        for (const cp of childPaths) {
          urlPaths.push({ segments: [key, ...cp.segments] });
        }
      }
    }

    if (changed) {
      const newSchema = z.object(newShape);
      console.log("[transformSchema] Reconstructed object with changed fields");
      console.log("[transformSchema] URL paths found:", urlPaths);
      return [newSchema, urlPaths];
    }
    return [schema, urlPaths];
  }

  // 4) If it's an array, transform its item type
  if (isKind(schema, "array")) {
    const arraySchema = schema as ZodWithInternals<$ZodArrayInternals>;
    const itemType = arraySchema._zod.def.element as z.ZodTypeAny;
    if (!itemType) {
      return [schema, []];
    }
    const [transformedItem, childPaths] = transformSchema(itemType, [
      ...currentPath,
      "*",
    ]);
    const changed = transformedItem !== itemType;
    const arrayPaths: ZodPathSegments[] = childPaths.map((cp) => ({
      segments: ["*", ...cp.segments],
    }));

    if (changed) {
      const newSchema = z.array(transformedItem);
      console.log(
        "[transformSchema] Reconstructed array with changed item type",
      );
      return [newSchema, arrayPaths];
    }
    return [schema, arrayPaths];
  }

  // 5) If it's a union, transform each option
  if (isKind(schema, "union")) {
    const unionSchema = schema as ZodWithInternals<$ZodUnionInternals>;
    const unionOptions = unionSchema._zod.def.options;
    if (!unionOptions || unionOptions.length === 0) {
      return [schema, []];
    }
    const newOptions: z.ZodTypeAny[] = [];
    let changed = false;
    let allPaths: ZodPathSegments[] = [];

    unionOptions.forEach((option: z.ZodTypeAny, idx: number) => {
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
      // We assume at least two options remain:
      return [
        z.union(newOptions as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]),
        allPaths,
      ];
    }
    return [schema, allPaths];
  }

  // 6) If it's an intersection, transform left and right
  if (isKind(schema, "intersection")) {
    const intersectionSchema =
      schema as ZodWithInternals<$ZodIntersectionInternals>;
    const leftType = intersectionSchema._zod.def.left as z.ZodTypeAny;
    const rightType = intersectionSchema._zod.def.right as z.ZodTypeAny;
    if (!leftType || !rightType) {
      return [schema, []];
    }

    const [left, leftPaths] = transformSchema(leftType, [
      ...currentPath,
      "intersection_left",
    ]);
    const [right, rightPaths] = transformSchema(rightType, [
      ...currentPath,
      "intersection_right",
    ]);
    const changed = left !== leftType || right !== rightType;
    const allPaths = [...leftPaths, ...rightPaths];
    if (changed) {
      return [z.intersection(left, right), allPaths];
    }
    return [schema, allPaths];
  }

  // 7) If it's optional, transform inner
  if (isKind(schema, "optional")) {
    const optionalSchema = schema as ZodWithInternals<$ZodOptionalInternals>;
    const innerType = optionalSchema._zod.def.innerType as z.ZodTypeAny;
    if (!innerType) {
      return [schema, []];
    }
    const [inner, innerPaths] = transformSchema(innerType, currentPath);
    if (inner !== innerType) {
      return [z.optional(inner), innerPaths];
    }
    return [schema, innerPaths];
  }

  // 8) If it's nullable, transform inner
  if (isKind(schema, "nullable")) {
    const nullableSchema = schema as ZodWithInternals<$ZodNullableInternals>;
    const innerType = nullableSchema._zod.def.innerType as z.ZodTypeAny;
    if (!innerType) {
      return [schema, []];
    }
    const [inner, innerPaths] = transformSchema(innerType, currentPath);
    if (inner !== innerType) {
      return [z.nullable(inner), innerPaths];
    }
    return [schema, innerPaths];
  }

  // 9) If it's a pipe (which is what .transform() creates in Zod 4)
  if (isKind(schema, "pipe")) {
    const pipeSchema = schema as ZodWithInternals<$ZodPipeInternals>;
    const inSchema = pipeSchema._zod.def.in as z.ZodTypeAny;
    const outSchema = pipeSchema._zod.def.out as z.ZodTypeAny;
    if (!inSchema || !outSchema) {
      return [schema, []];
    }

    const [newIn, inPaths] = transformSchema(inSchema, currentPath);
    const [newOut, outPaths] = transformSchema(outSchema, currentPath);
    const allPaths = [...inPaths, ...outPaths];

    const changed = newIn !== inSchema || newOut !== outSchema;
    if (changed) {
      // Reconstruct the pipe with transformed schemas
      // In Zod 4, we use z.pipe() to create pipes
      const result = z.pipe(newIn as never, newOut as never) as z.ZodTypeAny;

      // Note: Transform functions from the original pipe are not preserved
      // This is a limitation of the current implementation
      return [result, allPaths];
    }
    return [schema, allPaths];
  }

  // 10) For any other type (including standalone transforms), return as-is
  // Standalone transforms (z.transform(fn)) don't have nested schemas to recurse into
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
function isKind(s: z.ZodTypeAny, kind: string): boolean {
  try {
    return getZodType(s) === kind;
  } catch {
    return false;
  }
}

function makeIdStringSchema(orig: z.ZodString): z.ZodString {
  // In Zod 4, description is accessed via .description property
  const userDesc =
    (orig as unknown as { description?: string }).description ?? "";

  const base =
    "This field must be the element-ID in the form 'frameId-backendId' " +
    '(e.g. "0-432").';
  const composed =
    userDesc.trim().length > 0
      ? `${base} that follows this user-defined description: ${userDesc}`
      : base;

  return z.string().regex(ID_PATTERN).describe(composed);
}

/**
 * Mapping from LLM provider names to their corresponding environment variable names for API keys.
 */
export const providerEnvVarMap: Partial<
  Record<ModelProvider | string, string>
> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  google: "GOOGLE_GENERATIVE_AI_API_KEY",
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
    logger({
      category: "init",
      message: `No known environment variable for provider '${provider}'`,
      level: 0,
    });
    return undefined;
  }

  const apiKeyFromEnv = process.env[envVarName];
  if (typeof apiKeyFromEnv === "string" && apiKeyFromEnv.length > 0) {
    return apiKeyFromEnv;
  }

  logger({
    category: "init",
    message: `API key for ${provider} not found in environment variable ${envVarName}`,
    level: 0,
  });

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

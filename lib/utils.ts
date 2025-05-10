import crypto from "crypto";
import { ZodFirstPartyTypeKind as Kind, z } from "zod";
import { ObserveResult, Page } from ".";
import { LogLine } from "../types/log";
import { ZodPathSegments } from "../types/stagehand";
import { Schema, Type } from "@google/genai";
import { ModelProvider } from "../types/model";

export function generateId(operation: string) {
  return crypto.createHash("sha256").update(operation).digest("hex");
}

export function logLineToString(logLine: LogLine): string {
  try {
    const timestamp = logLine.timestamp || new Date().toISOString();
    if (logLine.auxiliary?.error) {
      return `${timestamp}::[stagehand:${logLine.category}] ${logLine.message}\n ${logLine.auxiliary.error.value}\n ${logLine.auxiliary.trace.value}`;
    }
    return `${timestamp}::[stagehand:${logLine.category}] ${logLine.message} ${
      logLine.auxiliary ? JSON.stringify(logLine.auxiliary) : ""
    }`;
  } catch (error) {
    console.error(`Error logging line:`, error);
    return "error logging line";
  }
}

export function validateZodSchema(schema: z.ZodTypeAny, data: unknown) {
  try {
    schema.parse(data);
    return true;
  } catch {
    return false;
  }
}

export async function drawObserveOverlay(page: Page, results: ObserveResult[]) {
  // Convert single xpath to array for consistent handling
  const xpathList = results.map((result) => result.selector);

  // Filter out empty xpaths
  const validXpaths = xpathList.filter((xpath) => xpath !== "xpath=");

  await page.evaluate((selectors) => {
    selectors.forEach((selector) => {
      let element;
      if (selector.startsWith("xpath=")) {
        const xpath = selector.substring(6);
        element = document.evaluate(
          xpath,
          document,
          null,
          XPathResult.FIRST_ORDERED_NODE_TYPE,
          null,
        ).singleNodeValue;
      } else {
        element = document.querySelector(selector);
      }

      if (element instanceof HTMLElement) {
        const overlay = document.createElement("div");
        overlay.setAttribute("stagehandObserve", "true");
        const rect = element.getBoundingClientRect();
        overlay.style.position = "absolute";
        overlay.style.left = rect.left + "px";
        overlay.style.top = rect.top + "px";
        overlay.style.width = rect.width + "px";
        overlay.style.height = rect.height + "px";
        overlay.style.backgroundColor = "rgba(255, 255, 0, 0.3)";
        overlay.style.pointerEvents = "none";
        overlay.style.zIndex = "10000";
        document.body.appendChild(overlay);
      }
    });
  }, validXpaths);
}

export async function clearOverlays(page: Page) {
  // remove existing stagehandObserve attributes
  await page.evaluate(() => {
    const elements = document.querySelectorAll('[stagehandObserve="true"]');
    elements.forEach((el) => {
      const parent = el.parentNode;
      while (el.firstChild) {
        parent?.insertBefore(el.firstChild, el);
      }
      parent?.removeChild(el);
    });
  });
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
  const zodType = getZodType(zodSchema);

  switch (zodType) {
    case "ZodArray": {
      return decorateGeminiSchema(
        {
          type: Type.ARRAY,
          items: toGeminiSchema(
            (zodSchema as z.ZodArray<z.ZodTypeAny>).element,
          ),
        },
        zodSchema,
      );
    }
    case "ZodObject": {
      const properties: Record<string, Schema> = {};
      const required: string[] = [];

      Object.entries((zodSchema as z.ZodObject<z.ZodRawShape>).shape).forEach(
        ([key, value]: [string, z.ZodTypeAny]) => {
          properties[key] = toGeminiSchema(value);
          if (getZodType(value) !== "ZodOptional") {
            required.push(key);
          }
        },
      );

      return decorateGeminiSchema(
        {
          type: Type.OBJECT,
          properties,
          required: required.length > 0 ? required : undefined,
        },
        zodSchema,
      );
    }
    case "ZodString":
      return decorateGeminiSchema(
        {
          type: Type.STRING,
        },
        zodSchema,
      );
    case "ZodNumber":
      return decorateGeminiSchema(
        {
          type: Type.NUMBER,
        },
        zodSchema,
      );
    case "ZodBoolean":
      return decorateGeminiSchema(
        {
          type: Type.BOOLEAN,
        },
        zodSchema,
      );
    case "ZodEnum":
      return decorateGeminiSchema(
        {
          type: Type.STRING,
          enum: zodSchema._def.values,
        },
        zodSchema,
      );
    case "ZodDefault":
    case "ZodNullable":
    case "ZodOptional": {
      const innerSchema = toGeminiSchema(zodSchema._def.innerType);
      return decorateGeminiSchema(
        {
          ...innerSchema,
          nullable: true,
        },
        zodSchema,
      );
    }
    case "ZodLiteral":
      return decorateGeminiSchema(
        {
          type: Type.STRING,
          enum: [zodSchema._def.value],
        },
        zodSchema,
      );
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
  return schema._def.typeName;
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
  // 1) If it's a string with .url(), convert to z.number()
  if (isKind(schema, Kind.ZodString)) {
    const hasUrlCheck =
      schema._def.checks?.some(
        (check: { kind: string }) => check.kind === "url",
      ) ?? false;
    if (hasUrlCheck) {
      return [makeIdNumberSchema(schema as z.ZodString), [{ segments: [] }]];
    }
    return [schema, []];
  }

  // 2) If it's an object, transform each field
  if (isKind(schema, Kind.ZodObject)) {
    // The shape is a raw object containing fields keyed by string (no symbols):
    const shape = schema._def.shape() as Record<string, z.ZodTypeAny>;
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
      return [z.object(newShape), urlPaths];
    }
    return [schema, urlPaths];
  }

  // 3) If it's an array, transform its item type
  if (isKind(schema, Kind.ZodArray)) {
    const itemType = schema._def.type as z.ZodTypeAny;
    const [transformedItem, childPaths] = transformSchema(itemType, [
      ...currentPath,
      "*",
    ]);
    const changed = transformedItem !== itemType;
    const arrayPaths: ZodPathSegments[] = childPaths.map((cp) => ({
      segments: ["*", ...cp.segments],
    }));

    if (changed) {
      return [z.array(transformedItem), arrayPaths];
    }
    return [schema, arrayPaths];
  }

  // 4) If it's a union, transform each option
  if (isKind(schema, Kind.ZodUnion)) {
    // Cast the union’s options to an array of ZodTypeAny
    const unionOptions = schema._def.options as z.ZodTypeAny[];
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

  // 5) If it's an intersection, transform left and right
  if (isKind(schema, Kind.ZodIntersection)) {
    const leftType = schema._def.left as z.ZodTypeAny;
    const rightType = schema._def.right as z.ZodTypeAny;

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

  // 6) If it's optional, transform inner
  if (isKind(schema, Kind.ZodOptional)) {
    const innerType = schema._def.innerType as z.ZodTypeAny;
    const [inner, innerPaths] = transformSchema(innerType, currentPath);
    if (inner !== innerType) {
      return [z.optional(inner), innerPaths];
    }
    return [schema, innerPaths];
  }

  // 7) If it's nullable, transform inner
  if (isKind(schema, Kind.ZodNullable)) {
    const innerType = schema._def.innerType as z.ZodTypeAny;
    const [inner, innerPaths] = transformSchema(innerType, currentPath);
    if (inner !== innerType) {
      return [z.nullable(inner), innerPaths];
    }
    return [schema, innerPaths];
  }

  // 8) If it's an effect, transform base schema
  if (isKind(schema, Kind.ZodEffects)) {
    const baseSchema = schema._def.schema as z.ZodTypeAny;
    const [newBaseSchema, basePaths] = transformSchema(baseSchema, currentPath);
    if (newBaseSchema !== baseSchema) {
      return [z.effect(newBaseSchema, schema._def.effect), basePaths];
    }
    return [schema, basePaths];
  }

  // 9) If none of the above, return as-is
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
  const [key, ...rest] = path;

  if (key === "*") {
    if (Array.isArray(obj)) {
      for (const item of obj) {
        injectUrls(item, rest, idToUrlMapping);
      }
    }
    return;
  }

  if (obj && typeof obj === "object") {
    const record = obj as Record<string | number, unknown>;
    if (path.length === 1) {
      const fieldValue = record[key];
      if (typeof fieldValue === "number") {
        const mappedUrl = idToUrlMapping[String(fieldValue)];
        record[key] = mappedUrl ?? ``;
      }
    } else {
      injectUrls(record[key], rest, idToUrlMapping);
    }
  }
}

function isKind(s: z.ZodTypeAny, kind: Kind): boolean {
  return (s as z.ZodTypeAny)._def.typeName === kind;
}

function makeIdNumberSchema(orig: z.ZodString): z.ZodNumber {
  const userDesc =
    // Zod ≥3.23 exposes .description directly; fall back to _def for older minor versions
    (orig as unknown as { description?: string }).description ??
    (orig as unknown as { _def?: { description?: string } })._def
      ?.description ??
    "";

  const base =
    "This field must be filled with the numerical ID of the link element";
  const composed =
    userDesc.trim().length > 0
      ? `${base} that follows this user-defined description: ${userDesc}`
      : base;

  return z.number().describe(composed);
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

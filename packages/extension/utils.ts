import { ZodSchemaValidationError } from "./types/public/sdkErrors.js";
import { z } from "zod/v4";
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

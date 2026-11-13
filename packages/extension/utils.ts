import { z } from "zod/v4";
import type { ExtractIdFieldKind, ZodPathSegments } from "./types/private/internal.js";

const ID_PATTERN = /^\d+-\d+$/;

/**
 * JSON Schema keyword and value that mark an extract() string field as an element reference.
 * Keep in sync with the SDK helpers that emit it (`elementRef()` in sdk-ts).
 */
const EXTRACT_SCHEMA_MARKER_KEYWORD = "x-stagehand";
const EXTRACT_ELEMENT_MARKER = "element";

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
  throw result.error;
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
 * Returns true when a string schema carries the extract element marker
 * (`"x-stagehand": "element"` in JSON Schema, or `.meta({ "x-stagehand": "element" })` in Zod).
 */
export function isExtractElementSchema(schema: z.ZodType): boolean {
  const meta = z.globalRegistry.get(schema) as Record<string, unknown> | undefined;
  return meta?.[EXTRACT_SCHEMA_MARKER_KEYWORD] === EXTRACT_ELEMENT_MARKER;
}

/**
 * Throws when an element marker survived {@link transformSchema}, which happens when an element
 * field sits inside a schema shape the transform can't walk (for example a record). Without this
 * check the field would come back as free text and the marker would be sent to the model provider.
 */
export function assertNoUnresolvedElementFields(schema: z.ZodType): void {
  let jsonSchema: string;
  try {
    jsonSchema = JSON.stringify(z.toJSONSchema(schema));
  } catch {
    return;
  }
  if (jsonSchema.includes(`"${EXTRACT_SCHEMA_MARKER_KEYWORD}":"${EXTRACT_ELEMENT_MARKER}"`)) {
    throw new TypeError(
      "extract() element fields are supported inside objects, arrays, tuples, unions, and " +
        "optional, nullable, default, catch, or readonly wrappers. Records and recursive " +
        "schemas are not supported. Move the element field out of the unsupported schema shape.",
    );
  }
}

/**
 * Recursively traverses a given Zod schema, scanning for string fields whose values should be
 * resolved from element IDs: `z.string().url()` fields (resolved to the element's URL) and fields
 * marked as extract elements (resolved to an `xpath=` selector for the element).
 * Each such field is replaced with an element-ID string schema.
 *
 * This function is used internally by higher-level utilities (e.g., transforming entire object schemas)
 * and handles nested objects, arrays, unions, intersections, optionals.
 *
 * @param schema - The Zod schema to transform.
 * @param currentPath - An array of string/number keys representing the current schema path (used internally for recursion).
 * @param markedElement - True when a wrapper such as `.default()` carries the element marker for
 *   the string it wraps (Zod's JSON Schema round-trip attaches the marker to the wrapper).
 * @param inheritedDescription - The description such a wrapper carries for the field it wraps.
 * @returns A two-element tuple:
 *   1. The updated Zod schema, with any URL or element fields replaced by element-ID strings.
 *   2. An array of {@link ZodPathSegments} objects representing each replaced field, including the
 *      path segments and what the ID resolves to.
 */
export function transformSchema(
  schema: z.ZodType,
  currentPath: Array<string | number>,
  markedElement = false,
  inheritedDescription?: string,
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

    if (markedElement || isExtractElementSchema(schema)) {
      return [
        makeIdStringSchema(schema, "element", inheritedDescription),
        [{ segments: [], kind: "element" }],
      ];
    }
    if (hasUrlCheck) {
      return [
        makeIdStringSchema(schema, "url", inheritedDescription),
        [{ segments: [], kind: "url" }],
      ];
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
        urlPaths.push({ segments: [key, ...cp.segments], kind: cp.kind });
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
      kind: cp.kind,
    }));
    if (transformedItem !== itemType) {
      return [z.array(transformedItem), arrayPaths];
    }
    return [schema, arrayPaths];
  }

  if (isKind(schema, "tuple")) {
    const def = getZodDef(schema);
    const items = Array.isArray(def?.items) ? (def.items as z.ZodType[]) : undefined;
    if (!items) {
      return [schema, []];
    }
    const newItems: z.ZodType[] = [];
    const tuplePaths: ZodPathSegments[] = [];
    let changed = false;
    items.forEach((item, idx) => {
      const [newItem, childPaths] = transformSchema(item, [...currentPath, idx]);
      if (newItem !== item) {
        changed = true;
      }
      newItems.push(newItem);
      childPaths.forEach((cp) => {
        tuplePaths.push({ segments: [idx, ...cp.segments], kind: cp.kind });
      });
    });
    if (changed) {
      const rest = def?.rest as z.ZodType | undefined;
      const tupleItems = newItems as unknown as [z.ZodType, ...z.ZodType[]];
      return [rest ? z.tuple(tupleItems, rest) : z.tuple(tupleItems), tuplePaths];
    }
    return [schema, tuplePaths];
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

  // Value-fallback wrappers. The model always answers with an element ID, so a transformed field
  // keeps only its optionality; `.readonly()` has no effect on parsed data and is dropped.
  if (
    isKind(schema, "default") ||
    isKind(schema, "prefault") ||
    isKind(schema, "catch") ||
    isKind(schema, "readonly")
  ) {
    const innerType = getInnerType(schema);
    if (!innerType) {
      return [schema, []];
    }
    const [inner, innerPaths] = transformSchema(
      innerType,
      currentPath,
      markedElement || isExtractElementSchema(schema),
      getDescription(schema) ?? inheritedDescription,
    );
    if (inner !== innerType) {
      return [isKind(schema, "readonly") ? inner : inner.optional(), innerPaths];
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
 * Once we get the final extracted object that has element IDs in place of URL or element fields,
 * use `injectUrls` to walk the object and replace each ID with its resolved value from
 * idToUrlMapping (a URL, or an `xpath=` selector for element fields). IDs missing from the
 * mapping become an empty string and are reported through `onMissing`. The `path` may include `*`
 * for array indices (indicating "all items in the array").
 */
export function injectUrls(
  obj: unknown,
  path: Array<string | number>,
  idToUrlMapping: Record<string, string>,
  onMissing?: (id: string) => void,
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
  const resolve = (id: string): string => {
    const resolved = idToUrlMapping[id];
    if (resolved !== undefined) return resolved;
    onMissing?.(id);
    return "";
  };
  const [key, ...rest] = path;

  if (key === "*") {
    if (Array.isArray(obj)) {
      if (rest.length === 0) {
        for (let i = 0; i < obj.length; i += 1) {
          const id = toId(obj[i]);
          if (id !== undefined) {
            obj[i] = resolve(id);
          }
        }
      } else {
        for (const item of obj) injectUrls(item, rest, idToUrlMapping, onMissing);
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
        record[key] = resolve(id);
      }
    } else {
      injectUrls(record[key], rest, idToUrlMapping, onMissing);
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

function getDescription(schema: z.ZodType): string | undefined {
  const description = (schema as unknown as { description?: string }).description;
  return description?.trim() ? description : undefined;
}

function makeIdStringSchema(
  orig: z.ZodType,
  kind: ExtractIdFieldKind,
  fallbackDescription?: string,
): z.ZodType {
  const userDesc = getDescription(orig) ?? fallbackDescription ?? "";

  if (kind === "element") {
    const base =
      "This field must be the element-ID, in the form 'frameId-backendId' (e.g. \"0-432\"), " +
      "of the page element this field refers to. Inside an object, use the element that the " +
      "object's other extracted values came from.";
    const composed =
      userDesc.trim().length > 0 ? `${base} The element is described as: ${userDesc}` : base;
    return z.string().regex(ID_PATTERN).describe(composed);
  }

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

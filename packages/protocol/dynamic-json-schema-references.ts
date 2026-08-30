import type { DynamicJsonSchema } from "./dynamic-json-schema-types.js";
import { DynamicJsonSchemaError, isJsonObject } from "./dynamic-json-schema-types.js";

export const MAP_OF_SCHEMAS = [
  "$defs",
  "definitions",
  "dependentSchemas",
  "patternProperties",
  "properties",
] as const;

export const ARRAY_OF_SCHEMAS = ["allOf", "anyOf", "oneOf", "prefixItems"] as const;

export const SINGLE_SCHEMA = [
  "additionalItems",
  "additionalProperties",
  "contains",
  "contentSchema",
  "else",
  "if",
  "items",
  "not",
  "propertyNames",
  "then",
  "unevaluatedItems",
  "unevaluatedProperties",
] as const;

const STRUCTURAL_MAP_OF_SCHEMAS: readonly string[] = ["patternProperties", "properties"];
const STRUCTURAL_SINGLE_SCHEMA: readonly string[] = ["additionalProperties", "items"];

/** Replaces each nested schema with the mapped value. */
export function mapDynamicJsonSubschemas(
  schema: Record<string, unknown>,
  map: (child: unknown) => unknown,
  mode: "all" | "structural" = "all",
): void {
  const mapKeywords: readonly string[] =
    mode === "all" ? MAP_OF_SCHEMAS : STRUCTURAL_MAP_OF_SCHEMAS;
  for (const keyword of mapKeywords) {
    const schemas = schema[keyword];
    if (!isJsonObject(schemas)) continue;
    for (const key of Object.keys(schemas)) schemas[key] = map(schemas[key]);
  }
  for (const keyword of ARRAY_OF_SCHEMAS) {
    const schemas = schema[keyword];
    if (!Array.isArray(schemas)) continue;
    for (let index = 0; index < schemas.length; index += 1) {
      schemas[index] = map(schemas[index]);
    }
  }
  const singleKeywords: readonly string[] =
    mode === "all" ? SINGLE_SCHEMA : STRUCTURAL_SINGLE_SCHEMA;
  for (const keyword of singleKeywords) {
    if (!Object.hasOwn(schema, keyword)) continue;
    schema[keyword] = map(schema[keyword]);
  }
}

export function forEachDynamicJsonSubschema(
  schema: Record<string, unknown>,
  visit: (schema: unknown) => void,
  mode: "all" | "structural" = "all",
): void {
  mapDynamicJsonSubschemas(
    schema,
    (child) => {
      visit(child);
      return child;
    },
    mode,
  );
}

/** Sets additionalProperties: false on object schema nodes that omitted it. Skips const/enum/default. */
export function closeUnspecifiedObjectAdditionalProperties(value: unknown): void {
  const visited = new WeakSet<object>();
  const visit = (schema: unknown): void => {
    if (typeof schema === "boolean" || !isJsonObject(schema) || visited.has(schema)) return;
    visited.add(schema);
    const typeNames =
      typeof schema.type === "string"
        ? [schema.type]
        : Array.isArray(schema.type)
          ? schema.type.filter((entry): entry is string => typeof entry === "string")
          : [];
    if (
      schema.additionalProperties === undefined &&
      (typeNames.includes("object") || schema.properties !== undefined)
    ) {
      schema.additionalProperties = false;
    }
    forEachDynamicJsonSubschema(schema, visit);
  };
  visit(value);
}

export function resolveLocalJsonPointer(root: Record<string, unknown>, reference: string): unknown {
  if (reference === "#") return root;
  if (!reference.startsWith("#/")) {
    throw new DynamicJsonSchemaError("JSON Schema references must use local JSON Pointers.");
  }
  let current: unknown = root;
  for (const encodedPart of reference.slice(2).split("/")) {
    let decodedPart: string;
    try {
      decodedPart = decodeURIComponent(encodedPart);
    } catch (cause) {
      throw new DynamicJsonSchemaError(
        `JSON Schema reference contains invalid percent-encoding: ${reference}.`,
        { cause },
      );
    }
    const part = unescapeJsonPointerSegment(decodedPart);
    if (typeof current !== "object" || current === null || !Object.hasOwn(current, part)) {
      throw new DynamicJsonSchemaError(`JSON Schema reference does not resolve: ${reference}.`);
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/** Rewrites local references after moving a schema below a JSON Pointer path. */
export function relocateDynamicJsonSchemaReferences(
  schema: DynamicJsonSchema,
  pointerSegments: readonly string[],
): DynamicJsonSchema {
  const clone = structuredClone(schema);
  const prefix = pointerSegments.map(escapeJsonPointerSegment).join("/");
  const visited = new WeakSet<object>();

  const visit = (value: unknown): void => {
    if (typeof value === "boolean" || !isJsonObject(value) || visited.has(value)) return;
    visited.add(value);
    if (typeof value.$ref === "string") {
      value.$ref = value.$ref === "#" ? `#/${prefix}` : `#/${prefix}${value.$ref.slice(1)}`;
    }
    forEachDynamicJsonSubschema(value, visit);
  };

  visit(clone);
  return clone;
}

export function escapeJsonPointerSegment(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

export function unescapeJsonPointerSegment(value: string): string {
  return value.replaceAll("~1", "/").replaceAll("~0", "~");
}

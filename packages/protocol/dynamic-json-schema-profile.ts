import type { DynamicJsonSchema, JsonValue } from "./dynamic-json-schema-types.js";
import {
  DYNAMIC_JSON_SCHEMA_LIMITS,
  DynamicJsonSchemaError,
  inspectJsonValue,
  enumerableJsonEntries,
  isJsonObject,
} from "./dynamic-json-schema-types.js";
import {
  ARRAY_OF_SCHEMAS,
  closeUnspecifiedObjectAdditionalProperties,
  escapeJsonPointerSegment,
  MAP_OF_SCHEMAS,
  resolveLocalJsonPointer,
  SINGLE_SCHEMA,
} from "./dynamic-json-schema-references.js";

const LIMITS = DYNAMIC_JSON_SCHEMA_LIMITS;

const DIALECTS = new Set([
  "https://json-schema.org/draft/2020-12/schema",
  "https://json-schema.org/draft/2020-12/schema#",
]);
const JSON_SCHEMA_TYPES = new Set([
  "array",
  "boolean",
  "integer",
  "null",
  "number",
  "object",
  "string",
]);
const STANDARD_VOCABULARIES = new Set([
  "https://json-schema.org/draft/2020-12/vocab/core",
  "https://json-schema.org/draft/2020-12/vocab/applicator",
  "https://json-schema.org/draft/2020-12/vocab/unevaluated",
  "https://json-schema.org/draft/2020-12/vocab/validation",
  "https://json-schema.org/draft/2020-12/vocab/meta-data",
  "https://json-schema.org/draft/2020-12/vocab/format-annotation",
  "https://json-schema.org/draft/2020-12/vocab/content",
]);
const ASSERTED_FORMATS = new Set([
  "date",
  "time",
  "date-time",
  "duration",
  "uri",
  "uri-reference",
  "uri-template",
  "url",
  "email",
  "hostname",
  "ipv4",
  "ipv6",
  "regex",
  "uuid",
  "binary",
  "byte",
  "json-pointer",
  "json-pointer-uri-fragment",
  "relative-json-pointer",
]);
const SUPPORTED_KEYWORDS = new Set([
  "$schema",
  "$id",
  "$ref",
  "$defs",
  "$anchor",
  "$vocabulary",
  "$comment",
  "definitions",
  "type",
  "enum",
  "const",
  "anyOf",
  "oneOf",
  "allOf",
  "not",
  "properties",
  "required",
  "additionalProperties",
  "patternProperties",
  "propertyNames",
  "minProperties",
  "maxProperties",
  "dependentSchemas",
  "dependentRequired",
  "items",
  "prefixItems",
  "additionalItems",
  "unevaluatedItems",
  "contains",
  "minContains",
  "maxContains",
  "minItems",
  "maxItems",
  "uniqueItems",
  "unevaluatedProperties",
  "minLength",
  "maxLength",
  "pattern",
  "format",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "if",
  "then",
  "else",
  "title",
  "description",
  "discriminator",
  "default",
  "examples",
  "deprecated",
  "readOnly",
  "writeOnly",
  "contentEncoding",
  "contentMediaType",
  "contentSchema",
]);

/**
 * Copies and bounds untrusted draft 2020-12 JSON Schema before it reaches an
 * interpreter. Only local JSON Pointer references are accepted. The returned
 * value shares no mutable objects with the converter-owned input.
 */
export function validateDynamicJsonSchema(value: unknown): DynamicJsonSchema {
  if (!isJsonObject(value)) {
    throw new DynamicJsonSchemaError("JSON Schema conversion must return an object.");
  }

  const counters = { definitions: 0, nodes: 0, properties: 0, references: 0 };
  const clone = cloneJsonValue(value, 0, new WeakSet(), counters);
  if (!isJsonObject(clone)) {
    throw new DynamicJsonSchemaError("JSON Schema conversion must return an object.");
  }

  closeUnspecifiedObjectAdditionalProperties(clone);

  const dialect = clone.$schema;
  if (dialect !== undefined && (typeof dialect !== "string" || !DIALECTS.has(dialect))) {
    throw new DynamicJsonSchemaError(
      'JSON Schema must use draft 2020-12 when a "$schema" dialect is declared.',
    );
  }

  validateSchemaNode(clone, "#", true, new Set());
  validateReferenceChains(clone);

  const serialized = JSON.stringify(clone);
  if (new TextEncoder().encode(serialized).byteLength > LIMITS.bytes) {
    throw limitError(`JSON Schema exceeds the ${LIMITS.bytes}-byte size limit.`);
  }
  return clone as DynamicJsonSchema;
}

function cloneJsonValue(
  value: unknown,
  depth: number,
  ancestors: WeakSet<object>,
  counters: { definitions: number; nodes: number; properties: number; references: number },
): JsonValue {
  if (depth > LIMITS.depth) {
    throw limitError(`JSON Schema exceeds the maximum depth of ${LIMITS.depth}.`);
  }
  const node = inspectJsonValue(value, ancestors);
  if (node.kind === "primitive") return node.value;

  counters.nodes += 1;
  if (counters.nodes > LIMITS.nodes) {
    throw limitError(`JSON Schema exceeds the ${LIMITS.nodes}-node limit.`);
  }
  ancestors.add(value as object);

  if (node.kind === "array") {
    const result: JsonValue[] = [];
    for (let index = 0; index < node.value.length; index += 1) {
      result.push(cloneJsonValue(node.value[index], depth + 1, ancestors, counters));
    }
    ancestors.delete(value as object);
    return result;
  }

  const result: Record<string, JsonValue> = {};
  for (const { key, value: entry } of enumerableJsonEntries(node.value)) {
    if (key === "properties" && isJsonObject(entry)) {
      counters.properties += enumerableStringKeys(entry).length;
      if (counters.properties > LIMITS.properties) {
        throw limitError(`JSON Schema exceeds the ${LIMITS.properties}-property limit.`);
      }
    }
    if (key === "$defs" && isJsonObject(entry)) {
      counters.definitions += enumerableStringKeys(entry).length;
      if (counters.definitions > LIMITS.definitions) {
        throw limitError(`JSON Schema exceeds the ${LIMITS.definitions}-$defs limit.`);
      }
    }
    if (key === "$ref") {
      counters.references += 1;
      if (counters.references > LIMITS.references) {
        throw limitError(`JSON Schema exceeds the ${LIMITS.references}-$ref limit.`);
      }
    }
    Object.defineProperty(result, key, {
      configurable: true,
      enumerable: true,
      value: cloneJsonValue(entry, depth + 1, ancestors, counters),
      writable: true,
    });
  }
  ancestors.delete(value as object);
  return result;
}

function validateSchemaNode(
  value: unknown,
  path: string,
  root: boolean,
  visited: Set<object>,
): void {
  if (typeof value === "boolean") return;
  if (!isJsonObject(value)) throw schemaShapeError(path, "must be a JSON Schema object or boolean");
  if (visited.has(value)) return;
  visited.add(value);

  for (const keyword of enumerableStringKeys(value)) {
    if (!SUPPORTED_KEYWORDS.has(keyword)) {
      throw schemaShapeError(`${path}/${escapeJsonPointerSegment(keyword)}`, "is not supported");
    }
  }

  if (!root && value.$id !== undefined) {
    throw schemaShapeError(`${path}/$id`, "must not create a nested identifier scope");
  }
  if (
    !root &&
    value.$schema !== undefined &&
    (typeof value.$schema !== "string" || !DIALECTS.has(value.$schema))
  ) {
    throw schemaShapeError(`${path}/$schema`, "must not declare a conflicting dialect");
  }
  for (const keyword of [
    "$anchor",
    "$comment",
    "$id",
    "$schema",
    "contentEncoding",
    "contentMediaType",
    "description",
    "format",
    "title",
  ]) {
    if (value[keyword] !== undefined && typeof value[keyword] !== "string") {
      throw schemaShapeError(`${path}/${keyword}`, "must be a string");
    }
  }
  if (value.$ref !== undefined) validateLocalReference(value.$ref, `${path}/$ref`);
  validateTypeKeyword(value.type, `${path}/type`);

  for (const keyword of MAP_OF_SCHEMAS) {
    const map = value[keyword];
    if (map === undefined) continue;
    if (!isJsonObject(map)) throw schemaShapeError(`${path}/${keyword}`, "must be an object");
    for (const key of enumerableStringKeys(map)) {
      if (keyword === "patternProperties") validatePattern(key, `${path}/${keyword}/${key}`);
      validateSchemaNode(
        map[key],
        `${path}/${keyword}/${escapeJsonPointerSegment(key)}`,
        false,
        visited,
      );
    }
  }
  for (const keyword of ARRAY_OF_SCHEMAS) {
    const schemas = value[keyword];
    if (schemas === undefined) continue;
    if (!Array.isArray(schemas) || schemas.length === 0) {
      throw schemaShapeError(`${path}/${keyword}`, "must be a non-empty array of schemas");
    }
    schemas.forEach((schema, index) =>
      validateSchemaNode(schema, `${path}/${keyword}/${index}`, false, visited),
    );
  }
  for (const keyword of SINGLE_SCHEMA) {
    const schema = value[keyword];
    if (schema !== undefined) validateSchemaNode(schema, `${path}/${keyword}`, false, visited);
  }

  validateStringArray(value.required, `${path}/required`, true);
  validateDependentRequired(value.dependentRequired, `${path}/dependentRequired`);
  if (value.enum !== undefined && (!Array.isArray(value.enum) || value.enum.length === 0)) {
    throw schemaShapeError(`${path}/enum`, "must be a non-empty array");
  }
  if (value.pattern !== undefined) validatePattern(value.pattern, `${path}/pattern`);
  if (value.$vocabulary !== undefined) validateVocabulary(value.$vocabulary, `${path}/$vocabulary`);
  if (value.format !== undefined) validateFormat(value.format, value.pattern, `${path}/format`);
  if (value.examples !== undefined && !Array.isArray(value.examples)) {
    throw schemaShapeError(`${path}/examples`, "must be an array");
  }
  validateDiscriminator(value.discriminator, `${path}/discriminator`);

  for (const keyword of ["deprecated", "readOnly", "uniqueItems", "writeOnly"]) {
    if (value[keyword] !== undefined && typeof value[keyword] !== "boolean") {
      throw schemaShapeError(`${path}/${keyword}`, "must be a boolean");
    }
  }
  for (const keyword of [
    "maxContains",
    "maxItems",
    "maxLength",
    "maxProperties",
    "minContains",
    "minItems",
    "minLength",
    "minProperties",
  ]) {
    if (value[keyword] !== undefined)
      validateNonNegativeInteger(value[keyword], `${path}/${keyword}`);
  }
  for (const keyword of ["exclusiveMaximum", "exclusiveMinimum", "maximum", "minimum"]) {
    if (value[keyword] !== undefined && !isFiniteNumber(value[keyword])) {
      throw schemaShapeError(`${path}/${keyword}`, "must be a finite number");
    }
  }
  if (
    value.multipleOf !== undefined &&
    (!isFiniteNumber(value.multipleOf) || value.multipleOf <= 0)
  ) {
    throw schemaShapeError(`${path}/multipleOf`, "must be a positive finite number");
  }
  validateRange(value, "minItems", "maxItems", path);
  validateRange(value, "minLength", "maxLength", path);
  validateRange(value, "minProperties", "maxProperties", path);
  validateRange(value, "minContains", "maxContains", path);
}

function validateDiscriminator(value: unknown, path: string): void {
  if (value === undefined) return;
  if (!isJsonObject(value) || typeof value.propertyName !== "string") {
    throw schemaShapeError(path, "must contain a string propertyName");
  }
  for (const key of Object.keys(value)) {
    if (key !== "propertyName" && key !== "mapping") {
      throw schemaShapeError(`${path}/${escapeJsonPointerSegment(key)}`, "is not supported");
    }
  }
  if (
    value.mapping !== undefined &&
    (!isJsonObject(value.mapping) ||
      Object.values(value.mapping).some((entry) => typeof entry !== "string"))
  ) {
    throw schemaShapeError(`${path}/mapping`, "must be an object of strings");
  }
}

function validateReferenceChains(root: Record<string, unknown>): void {
  const visit = (value: unknown, referenceDepth: number, path: Set<object>): void => {
    if (typeof value !== "object" || value === null || path.has(value)) return;
    path.add(value);
    const record = Array.isArray(value) ? undefined : (value as Record<string, unknown>);
    const reference = record?.$ref;
    if (typeof reference === "string") {
      if (referenceDepth >= LIMITS.referenceDepth) {
        throw limitError(`JSON Schema exceeds the ${LIMITS.referenceDepth}-reference chain limit.`);
      }
      visit(resolveLocalJsonPointer(root, reference), referenceDepth + 1, path);
    }
    for (const entry of Array.isArray(value) ? value : Object.values(value)) {
      visit(entry, referenceDepth, path);
    }
    path.delete(value);
  };
  visit(root, 0, new Set());
}

function validateTypeKeyword(value: unknown, path: string): void {
  if (value === undefined) return;
  const values = typeof value === "string" ? [value] : value;
  if (!Array.isArray(values) || values.length === 0) {
    throw schemaShapeError(path, "must be a JSON Schema type name or non-empty array of names");
  }
  if (
    values.some((entry) => typeof entry !== "string" || !JSON_SCHEMA_TYPES.has(entry)) ||
    new Set(values).size !== values.length
  ) {
    throw schemaShapeError(path, "must contain unique JSON Schema type names");
  }
}

function validateStringArray(value: unknown, path: string, unique: boolean): void {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw schemaShapeError(path, "must be an array of strings");
  }
  if (unique && new Set(value).size !== value.length) {
    throw schemaShapeError(path, "must contain unique strings");
  }
}

function validateDependentRequired(value: unknown, path: string): void {
  if (value === undefined) return;
  if (!isJsonObject(value)) throw schemaShapeError(path, "must be an object of string arrays");
  for (const key of enumerableStringKeys(value)) {
    validateStringArray(value[key], `${path}/${escapeJsonPointerSegment(key)}`, true);
  }
}

function validateVocabulary(value: unknown, path: string): void {
  if (!isJsonObject(value) || Object.values(value).some((entry) => typeof entry !== "boolean")) {
    throw schemaShapeError(path, "must be an object with boolean values");
  }
  for (const vocabulary of Object.keys(value)) {
    if (!STANDARD_VOCABULARIES.has(vocabulary)) {
      throw schemaShapeError(`${path}/${escapeJsonPointerSegment(vocabulary)}`, "is not supported");
    }
  }
}

function validateFormat(value: unknown, pattern: unknown, path: string): void {
  if (typeof value !== "string") throw schemaShapeError(path, "must be a string");
  if (!ASSERTED_FORMATS.has(value) && typeof pattern !== "string") {
    throw schemaShapeError(path, "must use a supported format or provide an enforcing pattern");
  }
}

function validatePattern(value: unknown, path: string): void {
  if (typeof value !== "string") throw schemaShapeError(path, "must be a string");
  if (new TextEncoder().encode(value).byteLength > LIMITS.patternBytes) {
    throw limitError(`JSON Schema patterns must be no larger than ${LIMITS.patternBytes} bytes.`);
  }
  try {
    new RegExp(value, "u");
  } catch (cause) {
    throw new DynamicJsonSchemaError(`Invalid JSON Schema pattern at ${path}.`, { cause });
  }
}

function validateLocalReference(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || (value !== "#" && !value.startsWith("#/"))) {
    throw schemaShapeError(path, "must be a local and self-contained JSON Pointer reference");
  }
}

function validateNonNegativeInteger(value: unknown, path: string): void {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw schemaShapeError(path, "must be a non-negative integer");
  }
}

function validateRange(
  value: Record<string, unknown>,
  minimum: string,
  maximum: string,
  path: string,
): void {
  if (
    typeof value[minimum] === "number" &&
    typeof value[maximum] === "number" &&
    value[minimum] > value[maximum]
  ) {
    throw schemaShapeError(`${path}/${minimum}`, `must not exceed ${maximum}`);
  }
}

function enumerableStringKeys(value: object): string[] {
  return Reflect.ownKeys(value).filter(
    (key): key is string =>
      typeof key === "string" && Object.getOwnPropertyDescriptor(value, key)?.enumerable === true,
  );
}

function schemaShapeError(path: string, message: string): DynamicJsonSchemaError {
  return new DynamicJsonSchemaError(`JSON Schema keyword at ${path} ${message}.`);
}

function limitError(message: string): DynamicJsonSchemaError {
  return new DynamicJsonSchemaError(message);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

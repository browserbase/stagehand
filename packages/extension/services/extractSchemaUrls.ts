import {
  createDynamicJsonSubschemaMatcher,
  isJsonObject,
  relocateDynamicJsonSchemaReferences,
  resolveLocalJsonPointer,
  type DynamicJsonSchema,
} from "../../protocol/dynamic-json-schema.js";
import {
  ARRAY_OF_SCHEMAS,
  MAP_OF_SCHEMAS,
  SINGLE_SCHEMA,
  mapDynamicJsonSubschemas,
} from "../../protocol/dynamic-json-schema-references.js";

const ID_PATTERN = /^\d+-\d+$/u;
const ID_PATTERN_SOURCE = "^\\d+-\\d+$";
const URL_FORMATS = new Set(["uri", "url"]);

export interface UrlAwareExtractionSchema {
  readonly jsonSchema: DynamicJsonSchema;
  restoreUrls(value: unknown, idToUrl: Readonly<Record<string, string>>): unknown;
}

/** Creates the provider schema and retains its canonical schema for URL restoration. */
export function createUrlAwareExtractionSchema(
  schema: DynamicJsonSchema,
): UrlAwareExtractionSchema {
  const canonicalSchema = schema;
  const providerSchema = structuredClone(canonicalSchema);
  const rewritten = rewriteUrlSchemas(providerSchema, providerSchema, new WeakSet());
  const providerRoot = isJsonObject(rewritten) ? (rewritten as DynamicJsonSchema) : providerSchema;
  const matchesProviderSchema = createDynamicJsonSubschemaMatcher(providerRoot);

  return {
    jsonSchema: providerRoot,
    restoreUrls: (value, idToUrl) =>
      restoreSchemaValue(
        canonicalSchema,
        canonicalSchema,
        providerRoot,
        providerRoot,
        structuredClone(value),
        idToUrl,
        new Map(),
        matchesProviderSchema,
      ),
  };
}

function rewriteUrlSchemas(
  root: DynamicJsonSchema,
  schema: unknown,
  visited: WeakSet<object>,
): unknown {
  if (typeof schema === "boolean" || !isJsonObject(schema) || visited.has(schema)) return schema;
  visited.add(schema);

  if (typeof schema.$ref === "string") {
    const target = resolveLocalJsonPointer(root, schema.$ref);
    if (isUrlSchema(target)) return rewrittenUrlSchema(target);
    rewriteUrlSchemas(root, target, visited);
  }
  if (isUrlSchema(schema)) return rewrittenUrlSchema(schema);

  mapDynamicJsonSubschemas(schema, (child) => rewriteUrlSchemas(root, child, visited));
  return schema;
}

function isUrlSchema(schema: unknown): schema is Record<string, unknown> {
  return (
    isJsonObject(schema) &&
    schema.type === "string" &&
    typeof schema.format === "string" &&
    URL_FORMATS.has(schema.format)
  );
}

function rewrittenUrlSchema(source: Record<string, unknown>): Record<string, unknown> {
  const description = typeof source.description === "string" ? source.description.trim() : "";
  const base =
    "This field must be the element-ID in the form 'frameId-backendId' " + '(e.g. "0-432").';
  return {
    type: "string",
    pattern: ID_PATTERN_SOURCE,
    description: description
      ? `${base} that follows this user-defined description: ${description}`
      : base,
  };
}

function restoreSchemaValue(
  root: DynamicJsonSchema,
  schema: unknown,
  providerRoot: DynamicJsonSchema,
  providerSchema: unknown,
  candidate: unknown,
  idToUrl: Readonly<Record<string, string>>,
  activePairs: Map<object, Set<unknown>>,
  matchesProviderSchema: (schema: unknown, value: unknown) => boolean,
): unknown {
  if (typeof schema === "boolean" || !isJsonObject(schema)) return candidate;
  const activeValues = activePairs.get(schema) ?? new Set<unknown>();
  if (activeValues.has(candidate)) return candidate;
  if (!activePairs.has(schema)) activePairs.set(schema, activeValues);
  activeValues.add(candidate);

  const originalCandidate = candidate;
  const providerRecord = isJsonObject(providerSchema) ? providerSchema : undefined;
  const matchingBranches: Partial<Record<"anyOf" | "oneOf", boolean[]>> = {};
  for (const keyword of ["anyOf", "oneOf"] as const) {
    const schemas = schema[keyword];
    const providerSchemas = providerRecord?.[keyword];
    if (!Array.isArray(schemas)) continue;
    matchingBranches[keyword] = schemas.map((childSchema, index) =>
      matchesProviderSchema(
        Array.isArray(providerSchemas) ? providerSchemas[index] : childSchema,
        candidate,
      ),
    );
  }
  const conditionalBranch = Object.hasOwn(schema, "if")
    ? matchesProviderSchema(providerRecord?.if ?? schema.if, candidate)
      ? "then"
      : "else"
    : undefined;
  try {
    let value = candidate;
    if (typeof schema.$ref === "string") {
      const providerTarget =
        isJsonObject(providerSchema) && typeof providerSchema.$ref === "string"
          ? resolveLocalJsonPointer(providerRoot, providerSchema.$ref)
          : providerSchema;
      value = restoreSchemaValue(
        root,
        resolveLocalJsonPointer(root, schema.$ref),
        providerRoot,
        providerTarget,
        value,
        idToUrl,
        activePairs,
        matchesProviderSchema,
      );
    }
    if (
      schema.type === "string" &&
      typeof schema.format === "string" &&
      URL_FORMATS.has(schema.format)
    ) {
      const id = toDomId(value);
      return id === undefined ? value : (idToUrl[id] ?? "");
    }

    const restore = (childSchema: unknown, providerChildSchema: unknown, childValue: unknown) =>
      restoreSchemaValue(
        root,
        childSchema,
        providerRoot,
        providerChildSchema,
        childValue,
        idToUrl,
        activePairs,
        matchesProviderSchema,
      );
    if (isJsonObject(value)) {
      const objectValue = value;
      const evaluatedKeys = new Set<string>();
      for (const keyword of MAP_OF_SCHEMAS) {
        const schemas = schema[keyword];
        const providerSchemas = providerRecord?.[keyword];
        if (!isJsonObject(schemas)) continue;
        if (keyword === "$defs" || keyword === "definitions") continue;
        if (keyword === "dependentSchemas") {
          for (const [key, childSchema] of Object.entries(schemas)) {
            if (!Object.hasOwn(objectValue, key)) continue;
            const providerChildSchema = isJsonObject(providerSchemas)
              ? providerSchemas[key]
              : childSchema;
            restore(childSchema, providerChildSchema, objectValue);
          }
          continue;
        }
        if (keyword === "patternProperties") {
          for (const [pattern, childSchema] of Object.entries(schemas)) {
            const regex = new RegExp(pattern, "u");
            const providerChildSchema = isJsonObject(providerSchemas)
              ? providerSchemas[pattern]
              : childSchema;
            for (const key of Object.keys(objectValue)) {
              if (!regex.test(key)) continue;
              evaluatedKeys.add(key);
              objectValue[key] = restore(childSchema, providerChildSchema, objectValue[key]);
            }
          }
          continue;
        }
        for (const [key, childSchema] of Object.entries(schemas)) {
          if (!Object.hasOwn(objectValue, key)) continue;
          evaluatedKeys.add(key);
          const providerChildSchema = isJsonObject(providerSchemas)
            ? providerSchemas[key]
            : childSchema;
          objectValue[key] = restore(childSchema, providerChildSchema, objectValue[key]);
        }
      }
      for (const keyword of ["additionalProperties", "unevaluatedProperties"] as const) {
        const childSchema = schema[keyword];
        const providerChildSchema = providerRecord?.[keyword] ?? childSchema;
        if (!isJsonObject(childSchema)) continue;
        for (const key of Object.keys(objectValue)) {
          if (evaluatedKeys.has(key)) continue;
          objectValue[key] = restore(childSchema, providerChildSchema, objectValue[key]);
          evaluatedKeys.add(key);
        }
      }
    }

    if (Array.isArray(value)) {
      let prefixLength = 0;
      for (const keyword of ARRAY_OF_SCHEMAS) {
        const schemas = schema[keyword];
        const providerSchemas = providerRecord?.[keyword];
        if (keyword !== "prefixItems" || !Array.isArray(schemas)) continue;
        prefixLength = schemas.length;
        for (let index = 0; index < Math.min(value.length, schemas.length); index += 1) {
          const providerChildSchema = Array.isArray(providerSchemas)
            ? providerSchemas[index]
            : schemas[index];
          value[index] = restore(schemas[index], providerChildSchema, value[index]);
        }
      }
      for (const keyword of ["items", "additionalItems", "unevaluatedItems"] as const) {
        const childSchema = schema[keyword];
        const providerChildSchema = providerRecord?.[keyword] ?? childSchema;
        if (!isJsonObject(childSchema)) continue;
        for (let index = prefixLength; index < value.length; index += 1) {
          value[index] = restore(childSchema, providerChildSchema, value[index]);
        }
      }
      if (isJsonObject(schema.contains)) {
        const providerContains = providerRecord?.contains ?? schema.contains;
        for (let index = 0; index < value.length; index += 1) {
          if (!matchesProviderSchema(providerContains, value[index])) continue;
          value[index] = restore(schema.contains, providerContains, value[index]);
        }
      }
    }

    for (const keyword of ["allOf", "anyOf", "oneOf"] as const) {
      const schemas = schema[keyword];
      const providerSchemas = providerRecord?.[keyword];
      if (!Array.isArray(schemas)) continue;
      for (let index = 0; index < schemas.length; index += 1) {
        const childSchema = schemas[index];
        const providerChildSchema = Array.isArray(providerSchemas)
          ? providerSchemas[index]
          : childSchema;
        if (keyword !== "allOf" && matchingBranches[keyword]?.[index] !== true) continue;
        value = restore(childSchema, providerChildSchema, value);
      }
    }
    for (const keyword of SINGLE_SCHEMA) {
      if (
        keyword === "additionalItems" ||
        keyword === "additionalProperties" ||
        keyword === "contains" ||
        keyword === "contentSchema" ||
        keyword === "else" ||
        keyword === "if" ||
        keyword === "items" ||
        keyword === "not" ||
        keyword === "propertyNames" ||
        keyword === "then" ||
        keyword === "unevaluatedItems" ||
        keyword === "unevaluatedProperties"
      ) {
        continue;
      }
      if (!Object.hasOwn(schema, keyword)) continue;
      const providerChildSchema = providerRecord?.[keyword] ?? schema[keyword];
      value = restore(schema[keyword], providerChildSchema, value);
    }
    if (conditionalBranch && Object.hasOwn(schema, conditionalBranch)) {
      value = restore(
        schema[conditionalBranch],
        providerRecord?.[conditionalBranch] ?? schema[conditionalBranch],
        value,
      );
    }
    return value;
  } finally {
    activeValues.delete(originalCandidate);
  }
}

function toDomId(value: unknown): string | undefined {
  if (typeof value === "number") return String(value);
  return typeof value === "string" && ID_PATTERN.test(value) ? value : undefined;
}

export function wrapRootSchema(schema: DynamicJsonSchema, key: string): DynamicJsonSchema {
  for (const keyword of ["$id", "$anchor"] as const) {
    if (schema[keyword] !== undefined) {
      throw new TypeError(
        `Cannot wrap a non-object JSON Schema containing ${keyword}; relocation would change its reference scope.`,
      );
    }
  }
  const { $schema, ...body } = relocateDynamicJsonSchemaReferences(schema, ["properties", key]);
  return {
    ...($schema === undefined ? {} : { $schema }),
    type: "object",
    properties: { [key]: body },
    required: [key],
    additionalProperties: false,
  } as DynamicJsonSchema;
}

/** Whether every value accepted at the root must be an object. */
export function schemaRequiresObject(root: DynamicJsonSchema): boolean {
  const visit = (schema: unknown, path: Set<object>): boolean => {
    if (!isJsonObject(schema) || path.has(schema)) return false;
    path.add(schema);
    try {
      if (schema.type === "object") return true;
      if (Array.isArray(schema.type) && schema.type.length === 1 && schema.type[0] === "object") {
        return true;
      }
      if (
        typeof schema.$ref === "string" &&
        visit(resolveLocalJsonPointer(root, schema.$ref), path)
      ) {
        return true;
      }
      if (Array.isArray(schema.allOf) && schema.allOf.some((child) => visit(child, path))) {
        return true;
      }
      for (const keyword of ["anyOf", "oneOf"] as const) {
        const branches = schema[keyword];
        if (
          Array.isArray(branches) &&
          branches.length > 0 &&
          branches.every((child) => visit(child, path))
        ) {
          return true;
        }
      }
      return false;
    } finally {
      path.delete(schema);
    }
  };
  return visit(root, new Set());
}

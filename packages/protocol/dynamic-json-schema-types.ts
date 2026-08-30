export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export type DynamicJsonSchema = { [key: string]: JsonValue };

export interface DynamicJsonSchemaIssue {
  readonly message: string;
  readonly path?: readonly PropertyKey[] | undefined;
}

export type DynamicJsonSchemaValidationResult<Output> =
  | { readonly value: Output; readonly issues?: undefined }
  | { readonly issues: readonly DynamicJsonSchemaIssue[] };

export interface DynamicJsonSchemaValidator<Output = unknown> {
  readonly jsonSchema: DynamicJsonSchema;
  validate(value: unknown): DynamicJsonSchemaValidationResult<Output>;
}

export class DynamicJsonSchemaError extends TypeError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "DynamicJsonSchemaError";
  }
}

export const DYNAMIC_JSON_SCHEMA_LIMITS = {
  bytes: 1024 * 1024,
  depth: 64,
  definitions: 2_048,
  nodes: 20_000,
  patternBytes: 4_096,
  properties: 10_000,
  references: 10_000,
  referenceDepth: 256,
  validationWork: 2_000_000,
  valueNodes: 100_000,
} as const;

export function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type JsonContainer =
  | { readonly kind: "primitive"; readonly value: null | boolean | number | string }
  | { readonly kind: "array"; readonly value: unknown[] }
  | { readonly kind: "object"; readonly value: object };

/** Rejects non-JSON values, cycles, exotic prototypes, symbols, accessors, and sparse arrays. */
export function inspectJsonValue(value: unknown, ancestors: WeakSet<object>): JsonContainer {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return { kind: "primitive", value };
  }
  if (typeof value !== "object") {
    throw new DynamicJsonSchemaError("JSON values must contain only JSON-safe values.");
  }
  if (ancestors.has(value)) {
    throw new DynamicJsonSchemaError(
      "JSON values must not contain cycles or mutable shared references.",
    );
  }
  if (Array.isArray(value)) {
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key === "symbol") {
        throw new DynamicJsonSchemaError("JSON values must not contain symbol keys.");
      }
      if (key === "length") continue;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor)) {
        throw new DynamicJsonSchemaError("JSON values must not contain accessors.");
      }
      if (!/^(0|[1-9]\d*)$/u.test(key) || Number(key) >= value.length) {
        throw new DynamicJsonSchemaError("JSON arrays must not contain custom properties.");
      }
    }
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index)) {
        throw new DynamicJsonSchemaError("JSON arrays must not contain sparse entries.");
      }
    }
    return { kind: "array", value };
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new DynamicJsonSchemaError("JSON objects must use a plain or null prototype.");
  }
  return { kind: "object", value };
}

/** Enumerable string keys after rejecting symbols and accessors. */
export function enumerableJsonEntries(value: object): Array<{ key: string; value: unknown }> {
  const entries: Array<{ key: string; value: unknown }> = [];
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === "symbol") {
      throw new DynamicJsonSchemaError("JSON values must not contain symbol keys.");
    }
    if (Array.isArray(value) && key === "length") continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable) continue;
    if (!("value" in descriptor)) {
      throw new DynamicJsonSchemaError("JSON values must not contain accessors.");
    }
    entries.push({ key, value: descriptor.value });
  }
  return entries;
}

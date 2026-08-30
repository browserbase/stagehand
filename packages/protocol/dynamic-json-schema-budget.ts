import { resolveLocalJsonPointer } from "./dynamic-json-schema-references.js";
import type { DynamicJsonSchema } from "./dynamic-json-schema-types.js";
import {
  DYNAMIC_JSON_SCHEMA_LIMITS,
  DynamicJsonSchemaError,
  enumerableJsonEntries,
  inspectJsonValue,
} from "./dynamic-json-schema-types.js";

const LIMITS = DYNAMIC_JSON_SCHEMA_LIMITS;

/** Schema-side weight of one interpreted validation, independent of the candidate value. */
export function schemaValidationWeight(schema: DynamicJsonSchema): number {
  return countValidationWeight(schema, schema, new Set(), 0);
}

/** Rejects a candidate whose interpreted validation would exceed a fixed work budget. */
export function assertDynamicValueWork(schemaWeight: number, value: unknown): void {
  const valueNodes = countValueNodes(value, new WeakSet());
  if (schemaWeight * Math.max(1, valueNodes) > LIMITS.validationWork) {
    throw new DynamicJsonSchemaError(
      `Dynamic JSON Schema validation exceeds the ${LIMITS.validationWork}-operation work limit.`,
    );
  }
}

/** Rejects values whose interpreted validation would exceed a fixed work budget. */
export function assertDynamicValidationWork(schema: DynamicJsonSchema, value: unknown): void {
  assertDynamicValueWork(schemaValidationWeight(schema), value);
}

function countValidationWeight(
  value: unknown,
  root: Record<string, unknown>,
  path: Set<object>,
  referenceDepth: number,
): number {
  if (typeof value !== "object" || value === null || path.has(value)) return 1;
  path.add(value);
  let weight = 1;
  if (!Array.isArray(value)) {
    const reference = (value as Record<string, unknown>).$ref;
    if (typeof reference === "string") {
      if (referenceDepth >= LIMITS.referenceDepth) return LIMITS.validationWork + 1;
      weight += countValidationWeight(
        resolveLocalJsonPointer(root, reference),
        root,
        path,
        referenceDepth + 1,
      );
      if (weight > LIMITS.validationWork) return weight;
    }
  }
  for (const [key, entry] of Object.entries(value)) {
    const multiplier = key === "allOf" || key === "anyOf" || key === "oneOf" ? 2 : 1;
    weight += multiplier * countValidationWeight(entry, root, path, referenceDepth);
    if (weight > LIMITS.validationWork) return weight;
  }
  path.delete(value);
  return weight;
}

function countValueNodes(value: unknown, seen: WeakSet<object>): number {
  const node = inspectJsonValue(value, seen);
  if (node.kind === "primitive") return 1;
  seen.add(value as object);
  let count = 1;
  const children =
    node.kind === "array"
      ? node.value.map((entry, index) => ({ key: String(index), value: entry }))
      : enumerableJsonEntries(node.value);
  for (const { value: entry } of children) {
    count += countValueNodes(entry, seen);
    if (count > LIMITS.valueNodes) {
      throw new DynamicJsonSchemaError(
        `Dynamic JSON values exceed the ${LIMITS.valueNodes}-node limit.`,
      );
    }
  }
  return count;
}

import type { JsonValue } from "../client.js";

/** Turns the caller's JSON Schema into what to look for: scalar leaves and lists of items. */

export type JsonSchema = {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: JsonValue[];
  format?: string;
  description?: string;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
};

export type Leaf = {
  path: string[];
  kind: "string" | "number" | "integer" | "boolean" | "url" | "enum";
  description: string;
  options?: string[];
  required: boolean;
};

export type ListPlan = { path: string[]; fields: Leaf[]; primitive: boolean; required: boolean };

export type Plan = { leaves: Leaf[]; lists: ListPlan[] };

export class Unsupported extends Error {}

export const MAX_FIELDS = 24;

/** Flattens the JSON schema into copyable leaves and lists; throws Unsupported otherwise. */
export function planSchema(schema: JsonSchema): Plan {
  const plan: Plan = { leaves: [], lists: [] };
  const walk = (
    node: JsonSchema,
    path: string[],
    required: boolean,
    into: Leaf[] | undefined,
  ): void => {
    const resolved = unwrapNullable(node);
    const optional = resolved !== node;
    const type = Array.isArray(resolved.type)
      ? resolved.type.find((entry) => entry !== "null")
      : resolved.type;
    const description = resolved.description ?? node.description ?? "";

    if (type === "object" && resolved.properties) {
      for (const [key, child] of Object.entries(resolved.properties)) {
        walk(
          child,
          [...path, key],
          required && !optional && (resolved.required ?? []).includes(key),
          into,
        );
      }
      return;
    }
    if (type === "array" && resolved.items) {
      if (into) throw new Unsupported("nested_array");
      const items = unwrapNullable(resolved.items);
      const fields: Leaf[] = [];
      const itemType = Array.isArray(items.type) ? items.type[0] : items.type;
      if (itemType === "object") {
        walk(items, [], true, fields);
        plan.lists.push({ path, fields, primitive: false, required: required && !optional });
      } else {
        walk({ ...items, description: items.description ?? description }, ["value"], true, fields);
        plan.lists.push({ path, fields, primitive: true, required: required && !optional });
      }
      return;
    }
    const leaf = (kind: Leaf["kind"], options?: string[]): void => {
      (into ?? plan.leaves).push({
        path,
        kind,
        description,
        required: required && !optional,
        ...(options ? { options } : {}),
      });
    };
    if (resolved.enum && resolved.enum.every((entry) => typeof entry === "string")) {
      return leaf("enum", resolved.enum as string[]);
    }
    if (type === "string")
      return leaf(resolved.format === "uri" || resolved.format === "url" ? "url" : "string");
    if (type === "number" || type === "integer" || type === "boolean") return leaf(type);
    throw new Unsupported(`type_${String(type ?? "unknown")}`);
  };
  const root = unwrapNullable(schema);
  if ((Array.isArray(root.type) ? root.type[0] : root.type) !== "object")
    throw new Unsupported("root_not_object");
  walk(schema, [], true, undefined);
  return plan;
}

function unwrapNullable(node: JsonSchema): JsonSchema {
  const variants = node.anyOf ?? node.oneOf;
  if (!variants) return node;
  const real = variants.filter((variant) => variant.type !== "null");
  if (real.length !== 1) throw new Unsupported("union");
  return real[0]!;
}

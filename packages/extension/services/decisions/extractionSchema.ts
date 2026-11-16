export type JsonSchema = {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  format?: string;
  description?: string;
  anyOf?: JsonSchema[];
};

export type FieldType = "string" | "number" | "integer" | "url";
export type Field = {
  name: string;
  description: string;
  type: FieldType;
  required: boolean;
  nullable?: boolean;
};
export type ListPlan = {
  name: string;
  description: string;
  fields: Field[];
  scalarItems: boolean;
  required: boolean;
};

function fieldType(node: JsonSchema): FieldType | undefined {
  const variants = node.anyOf?.filter((variant) => variant.type !== "null");
  if (variants?.length === 1) return fieldType(variants[0]!);
  const type = Array.isArray(node.type) ? node.type.find((t) => t !== "null") : node.type;
  if (type === "string") return node.format === "uri" ? "url" : "string";
  if (type === "number" || type === "integer") return type;
  return undefined;
}

function nullable(node: JsonSchema): boolean {
  return (
    node.type === "null" ||
    (Array.isArray(node.type) && node.type.includes("null")) ||
    !!node.anyOf?.some((variant) => variant.type === "null")
  );
}

export function plan(schema: JsonSchema) {
  if (schema.type !== "object" || !schema.properties) throw new Error("unsupported:root");
  const lists: ListPlan[] = [];
  const scalars: Field[] = [];
  const required = new Set(schema.required ?? []);
  for (const [name, node] of Object.entries(schema.properties ?? {})) {
    const description = node.description ?? "";
    const type = fieldType(node);
    if (type) {
      scalars.push({
        name,
        description,
        type,
        required: required.has(name),
        nullable: nullable(node),
      });
      continue;
    }
    if (node.type === "array" && node.items) {
      const itemType = fieldType(node.items);
      if (itemType) {
        lists.push({
          name,
          description,
          scalarItems: true,
          required: required.has(name),
          fields: [
            {
              name,
              description: node.items.description ?? description,
              type: itemType,
              required: true,
            },
          ],
        });
        continue;
      }
      const itemRequired = new Set(node.items.required ?? []);
      const fields = Object.entries(node.items.properties ?? {}).map(([field, child]) => {
        const childType = fieldType(child);
        if (!childType) throw new Error(`unsupported:${name}.${field}`);
        return {
          name: field,
          description: child.description ?? "",
          type: childType,
          required: itemRequired.has(field),
          nullable: nullable(child),
        };
      });
      lists.push({ name, description, fields, scalarItems: false, required: required.has(name) });
      continue;
    }
    throw new Error(`unsupported:${name}`);
  }
  return { lists, scalars };
}

export const fieldText = (field: Field) =>
  `${field.name.replaceAll("_", " ")}${field.description ? ` (${field.description})` : ""}`;

import { describe, expect, it } from "vitest";
import { z } from "zod/v4";
import * as JsonRpcSchemas from "../../json-rpc/schemas.js";
import * as SchemaRegistry from "../../schema-registry.js";
import * as ProtocolSchemas from "../../schemas.js";

describe("protocol schema metadata", () => {
  it("gives every exported Zod schema a stable JSON Schema ID", () => {
    const schemasById = new Map<string, z.ZodType>();

    for (const [moduleName, schemas] of Object.entries({
      ProtocolSchemas,
      JsonRpcSchemas,
      SchemaRegistry,
    })) {
      for (const [name, schema] of Object.entries(schemas)) {
        if (!name.endsWith("Schema") || !(schema instanceof z.ZodType)) continue;

        const id = z.globalRegistry.get(schema)?.id;
        expect(id, `${moduleName}.${name} must declare Zod metadata with an ID`).toBeTypeOf(
          "string",
        );
        const registeredSchema = schemasById.get(id!);
        expect(
          registeredSchema === undefined || registeredSchema === schema,
          `${moduleName}.${name} reuses JSON Schema ID ${id!} for a different Zod schema`,
        ).toBe(true);
        schemasById.set(id!, schema);
      }
    }
  });

  it("keeps every registered protocol schema wire-emittable", () => {
    for (const [kind, definitions] of Object.entries({
      method: SchemaRegistry.StagehandMethods,
      notification: SchemaRegistry.StagehandNotifications,
    })) {
      for (const definition of Object.values(definitions)) {
        for (const [role, schema] of Object.entries(definition)) {
          if (role !== "params" && role !== "result") continue;
          expect(
            () =>
              z.toJSONSchema(schema as z.ZodType, {
                io: "input",
                target: "draft-2020-12",
              }),
            `${kind} ${definition.name} ${role} must not contain runtime-only Zod values`,
          ).not.toThrow();
        }
      }
    }
  });
});

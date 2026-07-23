import { describe, expect, it } from "vite-plus/test";
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
});

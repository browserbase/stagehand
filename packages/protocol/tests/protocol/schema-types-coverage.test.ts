import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";

const protocolDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("protocol schema type coverage", () => {
  it.each([
    [["schemas.ts", "schema-registry.ts"], "types.ts"],
    [["json-rpc/schemas.ts"], "json-rpc/types.ts"],
  ])("maps every exported schema in %s to one z.infer alias in %s", async (schemas, types) => {
    const [schemaSources, typeSource] = await Promise.all([
      Promise.all(schemas.map((schema) => readFile(path.join(protocolDir, schema), "utf8"))),
      readFile(path.join(protocolDir, types), "utf8"),
    ]);

    const expected = schemaSources
      .flatMap((schemaSource) => [...schemaSource.matchAll(/export const (\w+Schema)\s*=/g)])
      .map((match) => [match[1]!.slice(0, -"Schema".length), match[1]!] as const)
      .sort(([left], [right]) => left.localeCompare(right));
    const actual = [
      ...typeSource.matchAll(/export type\s+(\w+)\s*=\s*z\.infer<\s*typeof\s+(\w+Schema)\s*>;/gs),
    ]
      .map((match) => [match[1]!, match[2]!] as const)
      .sort(([left], [right]) => left.localeCompare(right));

    expect(actual).toStrictEqual(expected);
  });
});

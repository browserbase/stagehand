import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";

const protocolDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const schemaTypePairs = [
  {
    schemaFiles: ["schemas.ts", "pending-schemas.ts", "schema-registry.ts"],
    typesFile: "types.ts",
  },
  {
    schemaFiles: ["json-rpc/schemas.ts"],
    typesFile: "json-rpc/types.ts",
  },
] as const;

function typeNameForSchema(schemaName: string): string {
  const nameWithoutSchema = schemaName.slice(0, -"Schema".length);
  return nameWithoutSchema[0]!.toUpperCase() + nameWithoutSchema.slice(1);
}

describe("protocol schemas must stay in sync with protocol types", () => {
  it.each(schemaTypePairs)(
    "$typesFile matches every schema exported from $schemaFiles",
    async ({ schemaFiles, typesFile }) => {
      const [schemaSources, typesSource] = await Promise.all([
        Promise.all(schemaFiles.map((file) => readFile(path.join(protocolDir, file), "utf8"))),
        readFile(path.join(protocolDir, typesFile), "utf8"),
      ]);

      const expected = schemaSources
        .flatMap((source) => [...source.matchAll(/export const (\w+Schema)\s*=/g)])
        .map((match) => [typeNameForSchema(match[1]!), match[1]!] as const)
        .sort(([left], [right]) => left.localeCompare(right));

      const actual = [...typesSource.matchAll(/export type\s+(\w+)\s*=\s*([^;]+);/gs)]
        .map((match) => {
          const typeName = match[1]!;
          const inference = match[2]!.match(/^z\.infer<\s*typeof\s+(\w+Schema)\s*>$/s);

          expect(
            inference,
            `${typeName} must directly infer from an exported canonical protocol schema`,
          ).not.toBeNull();

          return [typeName, inference![1]!] as const;
        })
        .sort(([left], [right]) => left.localeCompare(right));

      expect(actual).toStrictEqual(expected);
    },
  );
});

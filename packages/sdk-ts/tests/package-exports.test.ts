import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("TypeScript SDK package conditions", () => {
  it("routes Node to the local-capable build and every other runtime to web", async () => {
    const packageJson = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    ) as {
      exports: {
        ".": Record<string, string | { types: string; default: string }>;
      };
    };
    const rootExport = packageJson.exports["."];

    expect(Object.keys(rootExport)).toStrictEqual([
      "workerd",
      "deno",
      "bun",
      "browser",
      "node",
      "types",
      "default",
    ]);
    for (const condition of ["workerd", "deno", "bun", "browser"]) {
      expect(rootExport[condition]).toStrictEqual({
        types: "./dist/web/index.d.ts",
        default: "./dist/web/index.js",
      });
    }
    expect(rootExport.node).toStrictEqual({
      types: "./dist/node/index.d.ts",
      default: "./dist/node/index.js",
    });
    expect(rootExport.types).toBe("./dist/web/index.d.ts");
    expect(rootExport.default).toBe("./dist/web/index.js");
  });
});

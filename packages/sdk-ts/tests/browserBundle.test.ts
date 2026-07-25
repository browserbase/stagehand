import { build } from "vite";
import { describe, expect, it } from "vitest";

describe("TypeScript SDK browser bundle", () => {
  it("bundles the complete public entry without Node shims or Node-only packages", async () => {
    const output = await build({
      configFile: false,
      logLevel: "silent",
      build: {
        write: false,
        lib: {
          entry: new URL("../src/index.ts", import.meta.url).pathname,
          formats: ["es"],
        },
      },
    });
    const bundles = Array.isArray(output) ? output : [output];
    const bundledOutput = bundles.flatMap((bundle) => ("output" in bundle ? bundle.output : []));
    const code = bundledOutput
      .filter((chunk) => chunk.type === "chunk")
      .map((chunk) => chunk.code)
      .join("\n");

    expect(bundledOutput.map((output) => output.fileName)).not.toContainEqual(
      expect.stringContaining("__vite-browser-external"),
    );
    expect(code).not.toContain("__vite-browser-external");
    expect(code).not.toMatch(/(?:from\s*|import\()\s*["']node:/);
    expect(code).not.toContain("@browserbasehq/sdk");
    expect(code).not.toMatch(/\bBuffer\b/);
  });
});

import { readFile, readdir } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const sdkDirectory = new URL("..", import.meta.url);
const sdkSourceDirectory = new URL("../src/", import.meta.url);

const nodeRuntimePatterns = [
  { label: "Node module", pattern: /["']node:[^"']+["']/gu },
  { label: "Node-only package", pattern: /["']chrome-launcher["']/gu },
  { label: "process global", pattern: /\bprocess\.(?:argv|cwd|env|platform|release|versions)\b/gu },
  { label: "Buffer global", pattern: /\bBuffer(?:\.|<|\[|\()/gu },
  { label: "CommonJS require", pattern: /\brequire(?:\.resolve)?\s*\(/gu },
  { label: "Node type namespace", pattern: /\bNodeJS\./gu },
] as const;

describe("TypeScript SDK runtime portability", () => {
  it("keeps every remaining Node-specific runtime reference explicit", async () => {
    const references: string[] = [];
    const sourceFiles = (await readdir(sdkSourceDirectory, { recursive: true }))
      .filter((file) => file.endsWith(".ts"))
      .sort();

    for (const relativePath of sourceFiles) {
      const source = await readFile(new URL(relativePath, sdkSourceDirectory), "utf8");
      for (const { label, pattern } of nodeRuntimePatterns) {
        for (const match of source.matchAll(pattern)) {
          references.push(`${relativePath}: ${label}: ${match[0]}`);
        }
      }
    }

    expect(references.sort()).toStrictEqual([
      'runtime/node/localBrowserLauncher.ts: Node module: "node:child_process"',
      'runtime/node/localBrowserLauncher.ts: Node module: "node:fs/promises"',
      'runtime/node/localBrowserLauncher.ts: Node module: "node:os"',
      'runtime/node/localBrowserLauncher.ts: Node module: "node:path"',
      'runtime/node/localBrowserLauncher.ts: Node module: "node:process"',
    ]);
  });

  it("requires deliberate review of every direct runtime dependency", async () => {
    const packageJson = JSON.parse(
      await readFile(new URL("package.json", sdkDirectory), "utf8"),
    ) as { dependencies?: Record<string, string> };

    expect(Object.keys(packageJson.dependencies ?? {}).sort()).toStrictEqual([
      "@opentelemetry/api",
      "@opentelemetry/core",
      "up-fetch",
      "zod",
    ]);
  });
});

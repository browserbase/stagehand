import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";

const serverRoot = fileURLToPath(new URL("..", import.meta.url));

const forbiddenPatterns = [
  {
    label: "Node runtime import",
    pattern: /\bfrom\s+["'](?:node:)?(?:async_hooks|buffer|fs|os|path|ws)["']/u,
  },
  {
    label: "Node process API",
    pattern: /\bprocess\.(?:cwd|env|platform|versions)\b/u,
  },
  {
    label: "Node timer type",
    pattern: /\bNodeJS\.Timeout\b/u,
  },
  {
    label: "Node Buffer API or type",
    pattern: /\bBuffer(?:\.|<|\[)/u,
  },
  {
    label: "CDP headers",
    pattern: /\bcdpHeaders\b/u,
  },
] as const;

describe("service-worker source compatibility", () => {
  it("keeps production server modules free of Node-only runtime APIs", async () => {
    const files = (await readdir(serverRoot, { recursive: true }))
      .filter(
        (file) =>
          file.endsWith(".ts") &&
          !file.includes(".test.") &&
          file !== "paths.ts" &&
          file !== "vite.config.ts" &&
          !file.startsWith(`node_modules${path.sep}`),
      )
      .sort();
    const violations: string[] = [];

    for (const relativePath of files) {
      const source = await readFile(path.join(serverRoot, relativePath), "utf8");
      for (const { label, pattern } of forbiddenPatterns) {
        if (pattern.test(source)) violations.push(`${relativePath}: ${label}`);
      }
    }

    expect(violations).toStrictEqual([]);
  });
});

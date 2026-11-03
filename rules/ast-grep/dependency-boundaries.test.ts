import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  dependencyBoundaryViolations,
  manifestBoundaryViolations,
} from "./dependency-boundaries.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const shared = "packages/shared-object-model/src/page.ts";
const extension = "packages/extension/callbackBatch.ts";
const skippedDirectories = new Set(["node_modules", "dist", "artifacts", ".turbo"]);

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(path.join(root, directory), { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const relative = `${directory}/${entry.name}`;
      if (entry.isDirectory())
        return skippedDirectories.has(entry.name) ? [] : sourceFiles(relative);
      return entry.isFile() && /\.[cm]?[jt]sx?$/u.test(entry.name) ? [relative] : [];
    }),
  );
  return files.flat().sort();
}

describe("object model dependency boundaries", () => {
  it.each(["extension", "shared-object-model"])(
    "enforces source boundaries for %s",
    async (directory) => {
      const files = await sourceFiles(`packages/${directory}`);
      expect(files.length).toBeGreaterThan(0);
      const violations = (
        await Promise.all(
          files.map(async (file) =>
            dependencyBoundaryViolations(file, await readFile(path.join(root, file), "utf8")),
          ),
        )
      ).flat();
      expect(violations).toEqual([]);
    },
  );

  it.each(["extension", "shared-object-model"])(
    "enforces package dependencies for %s",
    async (directory) => {
      const manifest = JSON.parse(
        await readFile(path.join(root, "packages", directory, "package.json"), "utf8"),
      );
      expect(manifestBoundaryViolations(manifest.name, manifest)).toEqual([]);
    },
  );

  it.each([
    [extension, 'import { Page } from "../sdk-ts/src/page.js";'],
    [extension, 'export { Page } from "@browserbasehq/stagehand";'],
    [extension, 'export * from "../sdk-ts/src/index.js";'],
    [extension, 'type Page = import("@browserbasehq/stagehand").Page;'],
    [extension, 'const sdk = await import("@browserbasehq/stagehand");'],
    [extension, 'const sdk = require("../sdk-ts/src/index.js");'],
    [extension, 'import sdk = require("@browserbasehq/stagehand");'],
    [extension, 'import "../../tests/helpers/browserbaseBridge.js";'],
    [extension, 'import "./tests/helpers/example.js";'],
    [extension, 'import "./vite.config.js";'],
    [extension, 'import { readFile } from "node:fs/promises";'],
    ["packages/extension/tests/example.test.ts", 'import "../../sdk-ts/tests/helpers/example.js";'],
    [shared, 'import type { RPCClient } from "../../sdk-ts/src/rpcClient.js";'],
    [shared, 'import "@browserbasehq/stagehand-extension";'],
    [shared, 'import "../../extension/runtime.js";'],
    [shared, 'import "../../../tests/helpers/browserbaseBridge.js";'],
    [shared, 'import "../tests/example.js";'],
    [shared, 'import "@browserbasehq/sdk";'],
    [shared, 'import { readFile } from "node:fs/promises";'],
    [shared, 'export * from "fs/promises";'],
    [shared, 'const fs = await import("node:" + "fs/promises");'],
    [shared, 'const moduleName = "node:fs"; const fs = await import(moduleName);'],
    [shared, 'process.emitWarning("warning");'],
    [shared, 'Buffer.from("hello");'],
    [shared, 'globalThis.Buffer.from("hello");'],
    [shared, 'globalThis["Buffer"].from("hello");'],
    [shared, "let timeout: NodeJS.Timeout;"],
  ])("rejects forbidden dependency in %s: %s", (file, source) => {
    expect(dependencyBoundaryViolations(file, source).length).toBeGreaterThan(0);
  });

  it.each([
    [extension, 'import { Page } from "@browserbasehq/stagehand-shared-object-model/page";'],
    [
      extension,
      'import { StagehandMethods } from "@browserbasehq/stagehand-protocol/schema-registry";',
    ],
    [extension, 'import { RPCRouter } from "./rpcRouter.js";'],
    [shared, 'import type { StagehandCommandClient } from "./commandClient.js";'],
    [shared, 'import { z } from "zod/v4";'],
    [
      shared,
      'import { StagehandMethods } from "@browserbasehq/stagehand-protocol/schema-registry";',
    ],
    [shared, "const bytes = new Uint8Array(new ArrayBuffer(4));"],
    [shared, `// import "node:fs";\nconst text = 'process.emitWarning("example")';`],
    ["packages/extension/vite.config.ts", 'import { readFile } from "node:fs/promises";'],
    [
      "packages/extension/tests/example.test.ts",
      'import "../../../tests/helpers/browserbaseBridge.js";',
    ],
    [
      "packages/shared-object-model/tests/example.test.ts",
      'import { readFile } from "node:fs/promises";',
    ],
    [
      "tests/helpers/browserbaseBridge.ts",
      'import "../../packages/sdk-ts/src/browserbaseTransport.js";',
    ],
  ])("allows supported dependency in %s: %s", (file, source) => {
    expect(dependencyBoundaryViolations(file, source)).toEqual([]);
  });

  it("rejects package edges that would reintroduce the cycle", () => {
    expect(
      manifestBoundaryViolations("@browserbasehq/stagehand-extension", {
        devDependencies: { "@browserbasehq/stagehand": "workspace:*" },
      }),
    ).toHaveLength(1);
    expect(
      manifestBoundaryViolations("@browserbasehq/stagehand-shared-object-model", {
        devDependencies: { "@browserbasehq/stagehand-extension": "workspace:*" },
        dependencies: { "@browserbasehq/sdk": "catalog:" },
      }),
    ).toHaveLength(2);
  });
});

import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { describe, expect } from "vitest";
import { MCP_SDK_RANGE, MIDDLEWARE_RANGE } from "../src/lib/mcp/contract.js";
import { itPosix } from "./helpers/platform.js";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("package manifest", () => {
  itPosix("generates and packages the oclif manifest", async () => {
    const [manifestJson, packageJson] = await Promise.all([
      readFile(resolve(repoRoot, "oclif.manifest.json"), "utf8"),
      readFile(resolve(repoRoot, "package.json"), "utf8"),
    ]);

    const manifest = JSON.parse(manifestJson);
    const packageMetadata = JSON.parse(packageJson);

    expect(manifest.version).toBe(packageMetadata.version);
    expect(manifest.commands.status).toMatchObject({
      id: "status",
      isESM: true,
      relativePath: ["dist", "commands", "status.js"],
    });

    const { stdout } = await execFileAsync(
      "npm",
      ["pack", "--dry-run", "--json", "--ignore-scripts"],
      { cwd: repoRoot },
    );
    const [packed] = JSON.parse(stdout);
    const packedFiles = packed.files.map((file: { path: string }) => file.path);

    expect(packedFiles).toContain("oclif.manifest.json");
    // Setup copies these into the standalone Stagehand MCP runtime.
    expect(packedFiles).toContain("dist/lib/mcp/launcher.js");
    expect(packedFiles).toContain("dist/lib/mcp/main.js");
    expect(packedFiles).toContain("dist/lib/mcp/server.js");
    // browse never runs MCP itself; the adapter is type-checked and tested
    // against the same ranges setup installs.
    for (const [name, range] of [
      ["stagehand-middleware", MIDDLEWARE_RANGE],
      ["@modelcontextprotocol/sdk", MCP_SDK_RANGE],
    ]) {
      expect(packageMetadata.dependencies).not.toHaveProperty(name!);
      expect(packageMetadata.devDependencies[name!]).toBe(range);
    }
  });
});

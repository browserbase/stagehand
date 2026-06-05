import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("package manifest", () => {
  it("generates and packages the oclif manifest", async () => {
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
  });
});

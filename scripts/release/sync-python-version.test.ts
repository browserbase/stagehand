import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { syncPythonVersion } from "./sync-python-version.ts";

async function repositoryFixture({
  expected = "4.1.0",
  pyproject = "4.1.0",
  uvLock = "4.1.0",
}: {
  expected?: string;
  pyproject?: string;
  uvLock?: string;
} = {}): Promise<string> {
  const repositoryRoot = await mkdtemp(path.join(os.tmpdir(), "stagehand-python-sync-"));
  const pythonDirectory = path.join(repositoryRoot, "packages/sdk-python");
  await mkdir(pythonDirectory, { recursive: true });
  await writeFile(
    path.join(pythonDirectory, "package.json"),
    `${JSON.stringify({ version: expected }, null, 2)}\n`,
  );
  await writeFile(
    path.join(pythonDirectory, "pyproject.toml"),
    `[project]
  version = "${pyproject}"
`,
  );
  await writeFile(
    path.join(pythonDirectory, "uv.lock"),
    `[[package]]
name = "stagehand"
version = "${uvLock}"
source = { editable = "." }
`,
  );
  return repositoryRoot;
}

describe("syncPythonVersion", () => {
  it("accepts synchronized versions in check mode", async () => {
    const repositoryRoot = await repositoryFixture();
    await expect(syncPythonVersion({ checkOnly: true, repositoryRoot })).resolves.toBeUndefined();
  });

  it("reports a pyproject.toml mismatch", async () => {
    const repositoryRoot = await repositoryFixture({ pyproject: "4.0.0" });
    await expect(syncPythonVersion({ checkOnly: true, repositoryRoot })).rejects.toThrow(
      "pyproject.toml is 4.0.0; expected 4.1.0",
    );
  });

  it("reports a uv.lock mismatch", async () => {
    const repositoryRoot = await repositoryFixture({ uvLock: "4.0.0" });
    await expect(syncPythonVersion({ checkOnly: true, repositoryRoot })).rejects.toThrow(
      "uv.lock is 4.0.0; expected 4.1.0",
    );
  });

  it("updates an indented pyproject.toml version", async () => {
    const repositoryRoot = await repositoryFixture({ pyproject: "4.0.0" });
    await syncPythonVersion({ repositoryRoot });

    await expect(
      readFile(path.join(repositoryRoot, "packages/sdk-python/pyproject.toml"), "utf8"),
    ).resolves.toContain('  version = "4.1.0"');
  });
});

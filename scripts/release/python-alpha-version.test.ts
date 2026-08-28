import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { applyPythonAlphaVersion, pythonAlphaVersion } from "./python-alpha-version.ts";

async function repositoryFixture(proxyVersion: string): Promise<string> {
  const repositoryRoot = await mkdtemp(path.join(os.tmpdir(), "stagehand-python-alpha-"));
  const pythonDirectory = path.join(repositoryRoot, "packages/sdk-python");
  await mkdir(pythonDirectory, { recursive: true });
  await writeFile(
    path.join(pythonDirectory, "package.json"),
    `${JSON.stringify({ version: proxyVersion }, null, 2)}\n`,
  );
  await writeFile(
    path.join(pythonDirectory, "pyproject.toml"),
    `[project]
name = "stagehand"
version = "4.0.2"
`,
  );
  return repositoryRoot;
}

describe("pythonAlphaVersion", () => {
  it("maps a snapshot version onto a PEP 440 developmental release", () => {
    expect(pythonAlphaVersion("4.0.3-alpha-8b75044ee9163dc3c0d18fb11eed4a12246b4a03", 1451)).toBe(
      "4.0.3a0.dev1451",
    );
  });

  it("rejects versions that are not snapshots", () => {
    expect(() => pythonAlphaVersion("4.0.3", 1)).toThrow("Not a changesets snapshot version");
    expect(() => pythonAlphaVersion("4.0.3-beta-abc123", 1)).toThrow(
      "Not a changesets snapshot version",
    );
  });

  it("rejects invalid developmental release numbers", () => {
    expect(() => pythonAlphaVersion("4.0.3-alpha-abc123", -1)).toThrow(
      "Invalid developmental release number",
    );
    expect(() => pythonAlphaVersion("4.0.3-alpha-abc123", 1.5)).toThrow(
      "Invalid developmental release number",
    );
  });
});

describe("applyPythonAlphaVersion", () => {
  it("skips when the Python package did not receive a snapshot version", async () => {
    const repositoryRoot = await repositoryFixture("4.0.2");
    const devNumber = vi.fn();

    await expect(applyPythonAlphaVersion({ repositoryRoot, devNumber })).resolves.toEqual({
      shouldPublish: false,
    });
    expect(devNumber).not.toHaveBeenCalled();
    await expect(
      readFile(path.join(repositoryRoot, "packages/sdk-python/pyproject.toml"), "utf8"),
    ).resolves.toContain('version = "4.0.2"');
  });

  it("writes the alpha version into pyproject.toml", async () => {
    const repositoryRoot = await repositoryFixture("4.0.3-alpha-8b75044e");

    await expect(
      applyPythonAlphaVersion({ repositoryRoot, devNumber: async () => 1451 }),
    ).resolves.toEqual({ shouldPublish: true, version: "4.0.3a0.dev1451" });
    await expect(readFile(path.join(repositoryRoot, "packages/sdk-python/pyproject.toml"), "utf8"))
      .resolves.toBe(`[project]
name = "stagehand"
version = "4.0.3a0.dev1451"
`);
  });

  it("leaves pyproject.toml untouched in check mode", async () => {
    const repositoryRoot = await repositoryFixture("4.0.3-alpha-8b75044e");

    await expect(
      applyPythonAlphaVersion({ repositoryRoot, checkOnly: true, devNumber: async () => 1451 }),
    ).resolves.toEqual({ shouldPublish: true, version: "4.0.3a0.dev1451" });
    await expect(
      readFile(path.join(repositoryRoot, "packages/sdk-python/pyproject.toml"), "utf8"),
    ).resolves.toContain('version = "4.0.2"');
  });

  it("rejects a missing proxy version", async () => {
    const repositoryRoot = await repositoryFixture("4.0.2");
    await writeFile(path.join(repositoryRoot, "packages/sdk-python/package.json"), "{}\n");

    await expect(applyPythonAlphaVersion({ repositoryRoot })).rejects.toThrow(
      "Python version proxy does not define a string version",
    );
  });
});

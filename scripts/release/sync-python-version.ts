import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readPythonProjectVersion, updatePythonProjectVersion } from "./python-version.ts";

export type SyncPythonVersionOptions = {
  checkOnly?: boolean;
  repositoryRoot?: string;
};

export async function syncPythonVersion({
  checkOnly = false,
  repositoryRoot = path.resolve(import.meta.dirname, "../.."),
}: SyncPythonVersionOptions = {}): Promise<void> {
  const pythonDirectory = path.join(repositoryRoot, "packages/sdk-python");
  const proxyManifestPath = path.join(pythonDirectory, "package.json");
  const pyprojectPath = path.join(pythonDirectory, "pyproject.toml");
  const uvLockPath = path.join(pythonDirectory, "uv.lock");

  const proxyManifest = JSON.parse(await readFile(proxyManifestPath, "utf8")) as {
    version?: unknown;
  };
  if (typeof proxyManifest.version !== "string") {
    throw new TypeError("Python version proxy does not define a string version");
  }
  const expectedVersion = proxyManifest.version;

  const pyproject = await readFile(pyprojectPath, "utf8");
  const pyprojectVersion = readPythonProjectVersion(pyproject);

  if (!checkOnly && pyprojectVersion !== expectedVersion) {
    await writeFile(pyprojectPath, updatePythonProjectVersion(pyproject, expectedVersion));
  }

  if (checkOnly) {
    const uvLock = await readFile(uvLockPath, "utf8");
    const uvVersionPattern =
      /\[\[package\]\]\nname = "stagehand"\nversion = "(?<version>[^"]+)"\nsource = \{ editable = "\." \}/;
    const uvVersion = uvLock.match(uvVersionPattern)?.groups?.version;

    const mismatches = [
      pyprojectVersion === expectedVersion
        ? undefined
        : `pyproject.toml is ${pyprojectVersion}; expected ${expectedVersion}`,
      uvVersion === expectedVersion
        ? undefined
        : `uv.lock is ${uvVersion ?? "missing"}; expected ${expectedVersion}`,
    ].filter((message): message is string => message !== undefined);

    if (mismatches.length > 0) {
      throw new Error(`Python versions are out of sync:\n${mismatches.join("\n")}`);
    }
  }
}

const invokedPath = process.argv[1];
if (
  invokedPath !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(invokedPath)).href
) {
  await syncPythonVersion({ checkOnly: process.argv.includes("--check") });
}

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const pythonDirectory = path.join(repositoryRoot, "packages/sdk-python");
const proxyManifestPath = path.join(pythonDirectory, "package.json");
const pyprojectPath = path.join(pythonDirectory, "pyproject.toml");
const uvLockPath = path.join(pythonDirectory, "uv.lock");
const checkOnly = process.argv.includes("--check");

const proxyManifest = JSON.parse(await readFile(proxyManifestPath, "utf8")) as {
  version?: unknown;
};
if (typeof proxyManifest.version !== "string") {
  throw new TypeError("Python version proxy does not define a string version");
}
const expectedVersion = proxyManifest.version;

const pyproject = await readFile(pyprojectPath, "utf8");
const pyprojectVersionPattern = /^version = "(?<version>[^"]+)"$/m;
const pyprojectVersion = pyproject.match(pyprojectVersionPattern)?.groups?.version;
if (pyprojectVersion === undefined) {
  throw new Error("Could not find the Python project version in pyproject.toml");
}

if (!checkOnly && pyprojectVersion !== expectedVersion) {
  await writeFile(
    pyprojectPath,
    pyproject.replace(pyprojectVersionPattern, `version = "${expectedVersion}"`),
  );
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

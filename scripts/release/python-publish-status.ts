import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const changesetDirectory = path.join(repositoryRoot, ".changeset");
const pendingChangesets = (await readdir(changesetDirectory)).filter(
  (file) => file.endsWith(".md") && file !== "README.md",
);

if (pendingChangesets.length > 0) {
  process.stdout.write("false\n");
  process.exit(0);
}

const pyproject = await readFile(
  path.join(repositoryRoot, "packages/sdk-python/pyproject.toml"),
  "utf8",
);
const version = pyproject.match(/^version = "(?<version>[^"]+)"$/m)?.groups?.version;
if (version === undefined) {
  throw new Error("Could not find the Python project version in pyproject.toml");
}

const response = await fetch(`https://pypi.org/pypi/stagehand/${version}/json`);
if (response.status === 404) {
  process.stdout.write("true\n");
} else if (response.ok) {
  process.stdout.write("false\n");
} else {
  throw new Error(`PyPI returned ${response.status} while checking stagehand ${version}`);
}

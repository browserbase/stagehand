import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readPythonProjectVersion } from "./python-version.ts";

type StatusResponse = {
  ok: boolean;
  status: number;
};

export type PythonPublishStatusOptions = {
  repositoryRoot?: string;
  fetchStatus?: (url: string) => Promise<StatusResponse>;
};

export async function shouldPublishPython({
  repositoryRoot = path.resolve(import.meta.dirname, "../.."),
  fetchStatus = async (url) => await fetch(url),
}: PythonPublishStatusOptions = {}): Promise<boolean> {
  const changesetDirectory = path.join(repositoryRoot, ".changeset");
  const pendingChangesets = (await readdir(changesetDirectory)).filter(
    (file) => file.endsWith(".md") && file !== "README.md",
  );

  if (pendingChangesets.length > 0) {
    return false;
  }

  const pyproject = await readFile(
    path.join(repositoryRoot, "packages/sdk-python/pyproject.toml"),
    "utf8",
  );
  const version = readPythonProjectVersion(pyproject);
  const response = await fetchStatus(`https://pypi.org/pypi/stagehand/${version}/json`);
  if (response.status === 404) {
    return true;
  }
  if (response.ok) {
    return false;
  }
  throw new Error(`PyPI returned ${response.status} while checking stagehand ${version}`);
}

const invokedPath = process.argv[1];
if (
  invokedPath !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(invokedPath)).href
) {
  process.stdout.write(`${String(await shouldPublishPython())}\n`);
}

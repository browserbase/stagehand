import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { updatePythonProjectVersion } from "./python-version.ts";

const execFileAsync = promisify(execFile);

// Produced by `changeset version --snapshot` with the `alpha-{commit}` template.
const snapshotVersionPattern =
  /^(?<base>(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))-alpha-[0-9a-f]+$/u;

/**
 * Maps a changesets snapshot version (`4.0.3-alpha-<sha>`) onto the PEP 440
 * developmental release `4.0.3a0.dev<N>`.
 *
 * PyPI rejects local versions (`+<sha>`) and PEP 440 only allows digits in the
 * `.devN` segment, so the commit cannot be carried in the version itself. `a0`
 * sorts the build below the stable `4.0.3` it precedes and keeps it out of
 * `pip install stagehand` unless `--pre` is passed — the same role the `alpha`
 * dist-tag plays on npm. `N` must increase between pushes; the
 * `stagehand-python@<version>` git tag maps a build back to its commit.
 */
export function pythonAlphaVersion(snapshotVersion: string, devNumber: number): string {
  const base = snapshotVersionPattern.exec(snapshotVersion)?.groups?.base;
  if (base === undefined) {
    throw new Error(`Not a changesets snapshot version: ${snapshotVersion}`);
  }
  if (!Number.isInteger(devNumber) || devNumber < 0) {
    throw new Error(`Invalid developmental release number: ${String(devNumber)}`);
  }
  return `${base}a0.dev${String(devNumber)}`;
}

export type PythonAlphaVersionOptions = {
  checkOnly?: boolean;
  repositoryRoot?: string;
  devNumber?: () => Promise<number>;
};

export type PythonAlphaVersionStatus =
  | { shouldPublish: false }
  | { shouldPublish: true; version: string };

async function commitCount(repositoryRoot: string): Promise<number> {
  const { stdout } = await execFileAsync("git", ["rev-list", "--count", "HEAD"], {
    cwd: repositoryRoot,
  });
  return Number.parseInt(stdout.trim(), 10);
}

/**
 * Expects `changeset version --snapshot` to have run already. When the Python
 * proxy package received a snapshot version there is something unreleased to
 * publish, so pyproject.toml is rewritten to the matching PEP 440 version.
 * Otherwise nothing is touched and no alpha should be published.
 */
export async function applyPythonAlphaVersion({
  checkOnly = false,
  repositoryRoot = path.resolve(import.meta.dirname, "../.."),
  devNumber = async () => await commitCount(repositoryRoot),
}: PythonAlphaVersionOptions = {}): Promise<PythonAlphaVersionStatus> {
  const pythonDirectory = path.join(repositoryRoot, "packages/sdk-python");
  const proxyManifest = JSON.parse(
    await readFile(path.join(pythonDirectory, "package.json"), "utf8"),
  ) as { version?: unknown };
  if (typeof proxyManifest.version !== "string") {
    throw new TypeError("Python version proxy does not define a string version");
  }
  if (!snapshotVersionPattern.test(proxyManifest.version)) {
    return { shouldPublish: false };
  }

  const version = pythonAlphaVersion(proxyManifest.version, await devNumber());
  if (!checkOnly) {
    const pyprojectPath = path.join(pythonDirectory, "pyproject.toml");
    const pyproject = await readFile(pyprojectPath, "utf8");
    await writeFile(pyprojectPath, updatePythonProjectVersion(pyproject, version));
  }
  return { shouldPublish: true, version };
}

const invokedPath = process.argv[1];
if (
  invokedPath !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(invokedPath)).href
) {
  const status = await applyPythonAlphaVersion({ checkOnly: process.argv.includes("--check") });
  process.stdout.write(`should-publish=${String(status.shouldPublish)}\n`);
  if (status.shouldPublish) process.stdout.write(`version=${status.version}\n`);
}

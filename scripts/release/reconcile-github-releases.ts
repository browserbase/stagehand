import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

const execFileAsync = promisify(execFile);
const packageName = "@browserbasehq/stagehand";
const sectionPrefix = "TypeScript SDK ";
const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/u;

export type TypeScriptRelease = {
  version: string;
  tag: string;
  notes: string;
  prerelease: boolean;
};

export type ReconcileGitHubReleasesOptions = {
  repositoryRoot?: string;
  repository?: string;
  tagExists?: (tag: string) => Promise<boolean>;
  releaseExists?: (tag: string) => Promise<boolean>;
  createRelease?: (release: TypeScriptRelease) => Promise<void>;
};

type ExecFileError = Error & {
  code?: number | string;
  stderr?: string;
};

export class ChangelogParseError extends Error {
  constructor(reason: "invalid-version" | "empty-notes") {
    super(
      reason === "invalid-version"
        ? "Invalid TypeScript SDK changelog version"
        : "TypeScript SDK changelog entry has empty release notes",
    );
    this.name = "ChangelogParseError";
  }
}

export function parseTypeScriptReleases(changelog: string): TypeScriptRelease[] {
  const headings = [...changelog.matchAll(/^##\s+(.+)$/gmu)];
  const releases: TypeScriptRelease[] = [];

  for (const [index, match] of headings.entries()) {
    const heading = match[1]?.trim();
    if (heading === undefined || !heading.startsWith(sectionPrefix)) continue;

    const version = heading.slice(sectionPrefix.length);
    if (!semverPattern.test(version)) {
      throw new ChangelogParseError("invalid-version");
    }

    const start = (match.index ?? 0) + match[0].length;
    const end = headings[index + 1]?.index ?? changelog.length;
    const notes = changelog.slice(start, end).trim();
    if (notes.length === 0) {
      throw new ChangelogParseError("empty-notes");
    }

    releases.push({
      version,
      tag: `${packageName}@${version}`,
      notes,
      prerelease: version.includes("-"),
    });
  }

  // The root changelog is newest-first. Create missing historical releases
  // oldest-first so GitHub's automatic "Latest" selection ends on the newest SDK.
  return releases.reverse();
}

async function remoteTagExists(repositoryRoot: string, tag: string): Promise<boolean> {
  try {
    await execFileAsync(
      "git",
      ["ls-remote", "--exit-code", "--tags", "origin", `refs/tags/${tag}`],
      { cwd: repositoryRoot },
    );
    return true;
  } catch (error) {
    if ((error as ExecFileError).code === 2) return false;
    throw error;
  }
}

async function githubReleaseExists(repository: string, tag: string): Promise<boolean> {
  try {
    await execFileAsync("gh", ["release", "view", tag, "--repo", repository, "--json", "tagName"]);
    return true;
  } catch (error) {
    const execError = error as ExecFileError;
    if (execError.code === 1 && execError.stderr?.trim() === "release not found") return false;
    throw error;
  }
}

async function createGitHubRelease(
  repositoryRoot: string,
  repository: string,
  release: TypeScriptRelease,
): Promise<void> {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "stagehand-release-"));
  const notesPath = path.join(temporaryDirectory, "notes.md");

  try {
    await writeFile(notesPath, `${release.notes}\n`, { mode: 0o600 });
    const args = [
      "release",
      "create",
      release.tag,
      "--repo",
      repository,
      "--title",
      release.tag,
      "--notes-file",
      notesPath,
      "--verify-tag",
    ];
    if (release.prerelease) args.push("--prerelease");
    await execFileAsync("gh", args, { cwd: repositoryRoot });
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

export async function reconcileGitHubReleases({
  repositoryRoot = path.resolve(import.meta.dirname, "../.."),
  repository = process.env.GITHUB_REPOSITORY ?? "browserbase/stagehand",
  tagExists = async (tag) => await remoteTagExists(repositoryRoot, tag),
  releaseExists = async (tag) => await githubReleaseExists(repository, tag),
  createRelease = async (release) => await createGitHubRelease(repositoryRoot, repository, release),
}: ReconcileGitHubReleasesOptions = {}): Promise<string[]> {
  const changelog = await readFile(path.join(repositoryRoot, "CHANGELOG.md"), "utf8");
  const created: string[] = [];

  for (const release of parseTypeScriptReleases(changelog)) {
    if (!(await tagExists(release.tag)) || (await releaseExists(release.tag))) continue;

    await createRelease(release);
    created.push(release.tag);
  }

  return created;
}

const invokedPath = process.argv[1];
if (
  invokedPath !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(invokedPath)).href
) {
  const created = await reconcileGitHubReleases();
  if (created.length === 0) {
    process.stdout.write("GitHub Releases are already in sync.\n");
  } else {
    process.stdout.write(`Created GitHub Releases: ${created.join(", ")}\n`);
  }
}

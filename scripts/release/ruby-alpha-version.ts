import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { readRubyGemVersion, updateRubyGemVersion } from "./ruby-version.ts";

const execFileAsync = promisify(execFile);

// Produced by `changeset version --snapshot` with the `alpha-{commit}` template.
const snapshotVersionPattern =
  /^(?<base>(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))-alpha-[0-9a-f]+$/u;

/**
 * Maps a changesets snapshot version (`4.1.0-alpha-<sha>`) onto the RubyGems
 * prerelease `4.1.0.pre.alpha.<N>`.
 *
 * RubyGems sorts `.pre.` versions below the stable release they precede and
 * keeps them out of `gem install stagehand` unless `--pre` is passed — the
 * same role the `alpha` dist-tag plays on npm. `N` must increase between
 * pushes; the `stagehand-ruby@<version>` git tag maps a build back to its
 * commit.
 */
export function rubyAlphaVersion(snapshotVersion: string, buildNumber: number): string {
  const base = snapshotVersionPattern.exec(snapshotVersion)?.groups?.base;
  if (base === undefined) {
    throw new Error(`Not a changesets snapshot version: ${snapshotVersion}`);
  }
  if (!Number.isInteger(buildNumber) || buildNumber < 0) {
    throw new Error(`Invalid prerelease build number: ${String(buildNumber)}`);
  }
  return `${base}.pre.alpha.${String(buildNumber)}`;
}

export type RubyAlphaVersionOptions = {
  checkOnly?: boolean;
  repositoryRoot?: string;
  buildNumber?: () => Promise<number>;
};

export type RubyAlphaVersionStatus =
  | { shouldPublish: false }
  | { shouldPublish: true; version: string };

async function commitCount(repositoryRoot: string): Promise<number> {
  const { stdout } = await execFileAsync("git", ["rev-list", "--count", "HEAD"], {
    cwd: repositoryRoot,
  });
  return Number.parseInt(stdout.trim(), 10);
}

/**
 * Expects `changeset version --snapshot` to have run already. When the Ruby
 * proxy package received a snapshot version there is something unreleased to
 * publish, so lib/stagehand/version.rb is rewritten to the matching RubyGems
 * prerelease. Otherwise nothing is touched and no alpha should be published.
 */
export async function applyRubyAlphaVersion({
  checkOnly = false,
  repositoryRoot = path.resolve(import.meta.dirname, "../.."),
  buildNumber = async () => await commitCount(repositoryRoot),
}: RubyAlphaVersionOptions = {}): Promise<RubyAlphaVersionStatus> {
  const rubyDirectory = path.join(repositoryRoot, "packages/sdk-ruby");
  const proxyManifest = JSON.parse(
    await readFile(path.join(rubyDirectory, "package.json"), "utf8"),
  ) as { version?: unknown };
  if (typeof proxyManifest.version !== "string") {
    throw new TypeError("Ruby version proxy does not define a string version");
  }
  if (!snapshotVersionPattern.test(proxyManifest.version)) {
    return { shouldPublish: false };
  }

  const version = rubyAlphaVersion(proxyManifest.version, await buildNumber());
  if (!checkOnly) {
    const versionFilePath = path.join(rubyDirectory, "lib/stagehand/version.rb");
    const versionFile = await readFile(versionFilePath, "utf8");
    readRubyGemVersion(versionFile); // fail fast on an unexpected file shape
    await writeFile(versionFilePath, updateRubyGemVersion(versionFile, version));
  }
  return { shouldPublish: true, version };
}

const invokedPath = process.argv[1];
if (
  invokedPath !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(invokedPath)).href
) {
  const status = await applyRubyAlphaVersion({ checkOnly: process.argv.includes("--check") });
  process.stdout.write(`should-publish=${String(status.shouldPublish)}\n`);
  if (status.shouldPublish) process.stdout.write(`version=${status.version}\n`);
}

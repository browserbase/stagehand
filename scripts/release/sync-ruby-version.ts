import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readRubyGemVersion, rubyGemVersion, updateRubyGemVersion } from "./ruby-version.ts";

export type SyncRubyVersionOptions = {
  checkOnly?: boolean;
  repositoryRoot?: string;
};

// The Bundler lockfile pins the gem's own version under its PATH source.
const lockfileVersionPattern = /^(?<prefix>    stagehand \()(?<version>[^)]+)(?<suffix>\))$/mu;

export async function syncRubyVersion({
  checkOnly = false,
  repositoryRoot = path.resolve(import.meta.dirname, "../.."),
}: SyncRubyVersionOptions = {}): Promise<void> {
  const rubyDirectory = path.join(repositoryRoot, "packages/sdk-ruby");
  const proxyManifestPath = path.join(rubyDirectory, "package.json");
  const versionFilePath = path.join(rubyDirectory, "lib/stagehand/version.rb");
  const lockfilePath = path.join(rubyDirectory, "Gemfile.lock");

  const proxyManifest = JSON.parse(await readFile(proxyManifestPath, "utf8")) as {
    version?: unknown;
  };
  if (typeof proxyManifest.version !== "string") {
    throw new TypeError("Ruby version proxy does not define a string version");
  }
  const expectedVersion = rubyGemVersion(proxyManifest.version);

  const versionFile = await readFile(versionFilePath, "utf8");
  const gemVersion = readRubyGemVersion(versionFile);
  const lockfile = await readFile(lockfilePath, "utf8");
  const lockfileVersion = lockfileVersionPattern.exec(lockfile)?.groups?.version;
  if (lockfileVersion === undefined) {
    throw new Error("Could not find the stagehand PATH entry in Gemfile.lock");
  }

  if (!checkOnly) {
    if (gemVersion !== expectedVersion) {
      await writeFile(versionFilePath, updateRubyGemVersion(versionFile, expectedVersion));
    }
    if (lockfileVersion !== expectedVersion) {
      await writeFile(
        lockfilePath,
        lockfile.replace(
          lockfileVersionPattern,
          (_, prefix: string, __, suffix: string) => `${prefix}${expectedVersion}${suffix}`,
        ),
      );
    }
    return;
  }

  const mismatches = [
    gemVersion === expectedVersion
      ? undefined
      : `version.rb is ${gemVersion}; expected ${expectedVersion}`,
    lockfileVersion === expectedVersion
      ? undefined
      : `Gemfile.lock is ${lockfileVersion}; expected ${expectedVersion}`,
  ].filter((message): message is string => message !== undefined);

  if (mismatches.length > 0) {
    throw new Error(`Ruby versions are out of sync:\n${mismatches.join("\n")}`);
  }
}

const invokedPath = process.argv[1];
if (
  invokedPath !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(invokedPath)).href
) {
  await syncRubyVersion({ checkOnly: process.argv.includes("--check") });
}

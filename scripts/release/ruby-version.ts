const versionPattern = /^(?<prefix>\s*VERSION = ")(?<version>[^"]+)(?<suffix>")\s*$/mu;

export function readRubyGemVersion(contents: string): string {
  const version = versionPattern.exec(contents)?.groups?.version;
  if (version === undefined) {
    throw new Error("Could not find VERSION in lib/stagehand/version.rb");
  }
  return version;
}

export function updateRubyGemVersion(contents: string, version: string): string {
  if (!versionPattern.test(contents)) {
    throw new Error("Could not find VERSION in lib/stagehand/version.rb");
  }
  return contents.replace(
    versionPattern,
    (_, prefix: string, __, suffix: string) => `${prefix}${version}${suffix}`,
  );
}

/**
 * Maps a semver version onto RubyGems conventions: prerelease segments use
 * `.pre.` and dots instead of hyphens (`4.1.0-alpha.1` → `4.1.0.pre.alpha.1`),
 * so `gem install stagehand` never resolves to them without `--pre`.
 */
export function rubyGemVersion(semver: string): string {
  const [release, ...prerelease] = semver.split("-");
  if (!/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u.test(release ?? "")) {
    throw new Error(`Not a semver version: ${semver}`);
  }
  if (prerelease.length === 0) return semver;
  return `${release}.pre.${prerelease.join(".").replaceAll("-", ".")}`;
}

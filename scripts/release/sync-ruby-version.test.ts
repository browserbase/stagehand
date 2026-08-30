import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { rubyAlphaVersion } from "./ruby-alpha-version.ts";
import { readRubyGemVersion, rubyGemVersion, updateRubyGemVersion } from "./ruby-version.ts";
import { syncRubyVersion } from "./sync-ruby-version.ts";

const versionFile = (version: string): string => `# frozen_string_literal: true

module Stagehand
  VERSION = "${version}"
end
`;

async function repositoryFixture({
  expected = "4.1.0",
  gem = "4.1.0",
  lockfile = "4.1.0",
}: { expected?: string; gem?: string; lockfile?: string } = {}): Promise<string> {
  const repositoryRoot = await mkdtemp(path.join(os.tmpdir(), "stagehand-ruby-sync-"));
  const rubyDirectory = path.join(repositoryRoot, "packages/sdk-ruby/lib/stagehand");
  await mkdir(rubyDirectory, { recursive: true });
  await writeFile(
    path.join(repositoryRoot, "packages/sdk-ruby/package.json"),
    `${JSON.stringify({ version: expected }, null, 2)}\n`,
  );
  await writeFile(path.join(rubyDirectory, "version.rb"), versionFile(gem));
  await writeFile(
    path.join(repositoryRoot, "packages/sdk-ruby/Gemfile.lock"),
    `PATH
  remote: .
  specs:
    stagehand (${lockfile})
      websocket-driver (~> 0.8)
`,
  );
  return repositoryRoot;
}

describe("rubyGemVersion", () => {
  it("keeps release versions as-is", () => {
    expect(rubyGemVersion("4.1.0")).toBe("4.1.0");
  });

  it("maps semver prereleases onto .pre. segments", () => {
    expect(rubyGemVersion("4.1.0-alpha.1")).toBe("4.1.0.pre.alpha.1");
    expect(rubyGemVersion("4.1.0-alpha-3f2a1b")).toBe("4.1.0.pre.alpha.3f2a1b");
  });

  it("rejects non-semver versions", () => {
    expect(() => rubyGemVersion("4.1")).toThrow("Not a semver version");
  });
});

describe("ruby version.rb parsing", () => {
  it("round-trips the VERSION constant", () => {
    const contents = versionFile("4.1.0");
    expect(readRubyGemVersion(contents)).toBe("4.1.0");
    expect(readRubyGemVersion(updateRubyGemVersion(contents, "4.2.0"))).toBe("4.2.0");
  });

  it("rejects files without a VERSION constant", () => {
    expect(() => readRubyGemVersion("module Stagehand\nend\n")).toThrow("Could not find VERSION");
  });
});

describe("syncRubyVersion", () => {
  it("accepts synchronized versions in check mode", async () => {
    const repositoryRoot = await repositoryFixture();
    await expect(syncRubyVersion({ checkOnly: true, repositoryRoot })).resolves.toBeUndefined();
  });

  it("reports a version.rb mismatch in check mode", async () => {
    const repositoryRoot = await repositoryFixture({ gem: "4.0.0" });
    await expect(syncRubyVersion({ checkOnly: true, repositoryRoot })).rejects.toThrow(
      "version.rb is 4.0.0; expected 4.1.0",
    );
  });

  it("reports a Gemfile.lock mismatch in check mode", async () => {
    const repositoryRoot = await repositoryFixture({ lockfile: "4.0.0" });
    await expect(syncRubyVersion({ checkOnly: true, repositoryRoot })).rejects.toThrow(
      "Gemfile.lock is 4.0.0; expected 4.1.0",
    );
  });

  it("rewrites the Gemfile.lock PATH entry", async () => {
    const repositoryRoot = await repositoryFixture({ gem: "4.0.0", lockfile: "4.0.0" });
    await syncRubyVersion({ repositoryRoot });
    const lockfile = await readFile(
      path.join(repositoryRoot, "packages/sdk-ruby/Gemfile.lock"),
      "utf8",
    );
    expect(lockfile).toContain("stagehand (4.1.0)");
  });

  it("rewrites version.rb to the proxy version", async () => {
    const repositoryRoot = await repositoryFixture({ gem: "4.0.0" });
    await syncRubyVersion({ repositoryRoot });
    const rewritten = await readFile(
      path.join(repositoryRoot, "packages/sdk-ruby/lib/stagehand/version.rb"),
      "utf8",
    );
    expect(readRubyGemVersion(rewritten)).toBe("4.1.0");
  });

  it("converts prerelease proxy versions to gem conventions", async () => {
    const repositoryRoot = await repositoryFixture({
      expected: "4.1.0-alpha-abc123",
      gem: "4.0.0",
    });
    await syncRubyVersion({ repositoryRoot });
    const rewritten = await readFile(
      path.join(repositoryRoot, "packages/sdk-ruby/lib/stagehand/version.rb"),
      "utf8",
    );
    expect(readRubyGemVersion(rewritten)).toBe("4.1.0.pre.alpha.abc123");
  });
});

describe("rubyAlphaVersion", () => {
  it("maps snapshot versions onto RubyGems prereleases", () => {
    expect(rubyAlphaVersion("4.1.0-alpha-3f2a1b", 4321)).toBe("4.1.0.pre.alpha.4321");
  });

  it("rejects non-snapshot versions", () => {
    expect(() => rubyAlphaVersion("4.1.0", 1)).toThrow("Not a changesets snapshot version");
    expect(() => rubyAlphaVersion("4.1.0-alpha-3f2a1b", -1)).toThrow(
      "Invalid prerelease build number",
    );
  });
});

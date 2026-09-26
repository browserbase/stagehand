import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ChangelogParseError,
  parseTypeScriptReleases,
  reconcileGitHubReleases,
  type TypeScriptRelease,
} from "./reconcile-github-releases.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(async (directory) => {
      await rm(directory, { recursive: true, force: true });
    }),
  );
});

const changelog = `# Stagehand

## TypeScript SDK 4.0.2

### Patch Changes

- Fix reattachment.

## Python SDK 4.0.2

### Patch Changes

- Fix reattachment.

## TypeScript SDK 4.0.1

### Patch Changes

- Track the SDK version.

## 3.7.1

### Patch Changes

- Maintain v3.
`;

async function repositoryFixture(contents = changelog): Promise<string> {
  const repositoryRoot = await mkdtemp(path.join(os.tmpdir(), "stagehand-releases-"));
  temporaryDirectories.push(repositoryRoot);
  await writeFile(path.join(repositoryRoot, "CHANGELOG.md"), contents);
  return repositoryRoot;
}

describe("parseTypeScriptReleases", () => {
  it("extracts TypeScript notes oldest-first without including adjacent SDK sections", () => {
    expect(parseTypeScriptReleases(changelog)).toEqual([
      {
        version: "4.0.1",
        tag: "@browserbasehq/stagehand@4.0.1",
        notes: "### Patch Changes\n\n- Track the SDK version.",
        prerelease: false,
      },
      {
        version: "4.0.2",
        tag: "@browserbasehq/stagehand@4.0.2",
        notes: "### Patch Changes\n\n- Fix reattachment.",
        prerelease: false,
      },
    ]);
  });

  it("marks prereleases and rejects malformed versions", () => {
    expect(
      parseTypeScriptReleases("## TypeScript SDK 4.1.0-beta.1\n\n- Preview release.\n"),
    ).toEqual([
      {
        version: "4.1.0-beta.1",
        tag: "@browserbasehq/stagehand@4.1.0-beta.1",
        notes: "- Preview release.",
        prerelease: true,
      },
    ]);
    const malformedChangelog = () =>
      parseTypeScriptReleases("## TypeScript SDK next\n\n- Invalid.\n");
    expect(malformedChangelog).toThrow(ChangelogParseError);
    expect(malformedChangelog).toThrow("Invalid TypeScript SDK changelog version");
    expect(malformedChangelog).not.toThrow("next");
  });

  it("rejects empty release notes", () => {
    expect(() =>
      parseTypeScriptReleases("## TypeScript SDK 4.1.0\n\n## Python SDK 4.1.0\n"),
    ).toThrow("TypeScript SDK changelog entry has empty release notes");
  });
});

describe("reconcileGitHubReleases", () => {
  it("backfills missing releases once and marks only the newest tagged stable release latest", async () => {
    const repositoryRoot = await repositoryFixture(
      "## TypeScript SDK 4.2.0\n\n- Not tagged yet.\n\n" +
        "## TypeScript SDK 4.2.0-beta.1\n\n- Preview.\n\n" +
        "## TypeScript SDK 4.1.0\n\n- Current.\n\n" +
        changelog,
    );
    const existing = new Set<string>();
    const createRelease = vi.fn(async (release: TypeScriptRelease) => {
      existing.add(release.tag);
    });
    const options = {
      repositoryRoot,
      tagExists: async (tag: string) => tag !== "@browserbasehq/stagehand@4.2.0",
      releaseExists: async (tag: string) => existing.has(tag),
      createRelease,
    };

    expect(await reconcileGitHubReleases(options)).toEqual([
      "@browserbasehq/stagehand@4.0.1",
      "@browserbasehq/stagehand@4.0.2",
      "@browserbasehq/stagehand@4.1.0",
      "@browserbasehq/stagehand@4.2.0-beta.1",
    ]);
    expect(createRelease.mock.calls.map((call) => call[0].version)).toEqual([
      "4.0.1",
      "4.0.2",
      "4.1.0",
      "4.2.0-beta.1",
    ]);
    expect(createRelease).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ version: "4.1.0" }),
      { latest: true },
    );
    for (const call of [1, 2, 4]) {
      expect(createRelease).toHaveBeenNthCalledWith(call, expect.anything(), { latest: false });
    }
    createRelease.mockClear();
    expect(await reconcileGitHubReleases(options)).toEqual([]);
    expect(createRelease).not.toHaveBeenCalled();
  });

  it("does not mark an older backfill latest when the newest release already exists", async () => {
    const repositoryRoot = await repositoryFixture();
    const createRelease = vi.fn();
    expect(
      await reconcileGitHubReleases({
        repositoryRoot,
        tagExists: async () => true,
        releaseExists: async (tag) => tag.endsWith("4.0.2"),
        createRelease,
      }),
    ).toEqual(["@browserbasehq/stagehand@4.0.1"]);
    expect(createRelease).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ version: "4.0.1" }),
      { latest: false },
    );
  });

  it("chooses Latest by stable version even when a maintenance release appears first", async () => {
    const repositoryRoot = await repositoryFixture(
      "## TypeScript SDK 4.9.1\n\n- Maintenance release.\n\n" +
        "## TypeScript SDK 4.10.0\n\n- Newest stable version.\n",
    );
    const createRelease = vi.fn();
    await reconcileGitHubReleases({
      repositoryRoot,
      tagExists: async () => true,
      releaseExists: async () => false,
      createRelease,
    });
    expect(createRelease).toHaveBeenCalledWith(expect.objectContaining({ version: "4.10.0" }), {
      latest: true,
    });
    expect(createRelease).toHaveBeenCalledWith(expect.objectContaining({ version: "4.9.1" }), {
      latest: false,
    });
  });

  it("reports the same missing releases in dry-run mode without publishing", async () => {
    const repositoryRoot = await repositoryFixture();
    const createRelease = vi.fn();
    expect(
      await reconcileGitHubReleases({
        repositoryRoot,
        dryRun: true,
        tagExists: async () => true,
        releaseExists: async () => false,
        createRelease,
      }),
    ).toEqual(["@browserbasehq/stagehand@4.0.1", "@browserbasehq/stagehand@4.0.2"]);
    expect(createRelease).not.toHaveBeenCalled();
  });

  it("propagates lookup failures instead of treating them as missing releases", async () => {
    const repositoryRoot = await repositoryFixture();
    const createRelease = vi.fn();
    await expect(
      reconcileGitHubReleases({
        repositoryRoot,
        tagExists: async () => true,
        releaseExists: async () => {
          throw new Error("GitHub unavailable");
        },
        createRelease,
      }),
    ).rejects.toThrow("GitHub unavailable");
    expect(createRelease).not.toHaveBeenCalled();
  });

  it("creates only tagged releases that do not already exist", async () => {
    const repositoryRoot = await repositoryFixture();
    const tagExists = vi.fn(async (tag: string) => !tag.endsWith("4.0.1"));
    const releaseExists = vi.fn(async () => false);
    const created: TypeScriptRelease[] = [];

    await expect(
      reconcileGitHubReleases({
        repositoryRoot,
        tagExists,
        releaseExists,
        createRelease: async (release) => {
          created.push(release);
        },
      }),
    ).resolves.toEqual(["@browserbasehq/stagehand@4.0.2"]);

    expect(created).toEqual([parseTypeScriptReleases(changelog)[1]]);
    expect(releaseExists).toHaveBeenCalledTimes(1);
  });

  it("does not recreate an existing GitHub Release", async () => {
    const repositoryRoot = await repositoryFixture(
      "## TypeScript SDK 4.0.2\n\n- Fix reattachment.\n",
    );
    const createRelease = vi.fn();

    await expect(
      reconcileGitHubReleases({
        repositoryRoot,
        tagExists: async () => true,
        releaseExists: async () => true,
        createRelease,
      }),
    ).resolves.toEqual([]);
    expect(createRelease).not.toHaveBeenCalled();
  });
});

import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  parseTypeScriptReleases,
  reconcileGitHubReleases,
  type TypeScriptRelease,
} from "./reconcile-github-releases.ts";

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
    expect(() => parseTypeScriptReleases("## TypeScript SDK next\n\n- Invalid.\n")).toThrow(
      "Invalid TypeScript SDK changelog version: next",
    );
  });

  it("rejects empty release notes", () => {
    expect(() =>
      parseTypeScriptReleases("## TypeScript SDK 4.1.0\n\n## Python SDK 4.1.0\n"),
    ).toThrow("TypeScript SDK 4.1.0 has empty release notes");
  });
});

describe("reconcileGitHubReleases", () => {
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

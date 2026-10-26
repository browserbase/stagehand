import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  cleanupGeneratedChangelogs,
  consolidateChangelog,
  formatPackageChangelog,
  packageChangelogs,
  shouldPreservePackageChangelogs,
} from "./consolidate-changelogs.ts";

async function createTemporaryChangelog(): Promise<{
  directory: string;
  changelogPath: string;
}> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "stagehand-changelog-"));
  const changelogPath = path.join(directory, "CHANGELOG.md");
  await writeFile(changelogPath, "## 4.0.1\n");
  return { directory, changelogPath };
}

describe("formatPackageChangelog", () => {
  it("labels generated version headings and removes the package title", () => {
    expect(
      formatPackageChangelog(
        `# @browserbasehq/stagehand

## 4.1.0

### Minor Changes

- Add a feature.
`,
        "TypeScript SDK",
      ),
    ).toBe(`## TypeScript SDK 4.1.0

### Minor Changes

- Add a feature.`);
  });

  it("rejects a package changelog without a version heading", () => {
    expect(() => formatPackageChangelog("# Package\n\nNo releases yet.\n", "Python SDK")).toThrow(
      "The Python SDK changelog does not contain a version heading",
    );
  });

  it("labels the Eve package changelog for root release notes", () => {
    const eveChangelog = packageChangelogs.find(({ label }) => label === "Eve Extension");
    if (!eveChangelog) throw new Error("Missing Eve changelog configuration");
    expect(eveChangelog).toEqual({
      label: "Eve Extension",
      path: path.resolve(import.meta.dirname, "../../packages/integrations/eve/CHANGELOG.md"),
    });
    expect(
      formatPackageChangelog(
        "# @browserbasehq/eve\n\n## 0.2.0\n\n### Minor Changes\n\n- Add Code Mode.\n",
        eveChangelog.label,
      ),
    ).toContain("## Eve Extension 0.2.0");
  });
});

describe("consolidateChangelog", () => {
  const rootChangelog = `# Stagehand

Release notes for the public SDKs.

## 3.0.0

### Major Changes

- Release v3.
`;

  const typescriptSection = `## TypeScript SDK 4.1.0

### Minor Changes

- Add a feature.`;

  const pythonSection = `## Python SDK 4.0.1

### Patch Changes

- Fix a bug.`;

  const runtimeSection = `## Extension Runtime 4.0.1

### Patch Changes

- Update the embedded runtime.`;

  it("inserts SDK releases ahead of the existing history", () => {
    expect(consolidateChangelog(rootChangelog, [typescriptSection, pythonSection, runtimeSection]))
      .toBe(`# Stagehand

Release notes for the public SDKs.

## TypeScript SDK 4.1.0

### Minor Changes

- Add a feature.

## Python SDK 4.0.1

### Patch Changes

- Fix a bug.

## Extension Runtime 4.0.1

### Patch Changes

- Update the embedded runtime.

## 3.0.0

### Major Changes

- Release v3.
`);
  });

  it("does not add a generated release twice", () => {
    const consolidated = consolidateChangelog(rootChangelog, [typescriptSection]);
    expect(consolidateChangelog(consolidated, [typescriptSection])).toBe(consolidated);
  });

  it("recognizes an existing heading at end of file", () => {
    const rootAtHeading = `${rootChangelog.trim()}\n\n${typescriptSection.split("\n")[0]}`;
    expect(consolidateChangelog(rootAtHeading, [typescriptSection])).toBe(rootAtHeading);
  });

  it("rejects a root changelog without version headings", () => {
    expect(() => consolidateChangelog("# Stagehand\n", [typescriptSection])).toThrow(
      "The root changelog does not contain a version heading",
    );
  });

  it("rejects generated sections without version headings", () => {
    expect(() => consolidateChangelog(rootChangelog, ["No version heading."])).toThrow(
      "A generated changelog section does not contain a version heading",
    );
  });

  it("rejects a partially consolidated generated section", () => {
    const section = `${typescriptSection}\n\n${pythonSection}`;
    const rootWithTypeScript = consolidateChangelog(rootChangelog, [typescriptSection]);
    expect(() => consolidateChangelog(rootWithTypeScript, [section])).toThrow(
      "The root changelog contains only part of",
    );
  });
});

describe("cleanupGeneratedChangelogs", () => {
  it("preserves package changelogs when the release action requests it", async () => {
    const { directory, changelogPath } = await createTemporaryChangelog();

    try {
      await cleanupGeneratedChangelogs([changelogPath], true);

      await expect(readFile(changelogPath, "utf8")).resolves.toBe("## 4.0.1\n");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("deletes package changelogs when preservation is disabled", async () => {
    const { directory, changelogPath } = await createTemporaryChangelog();

    try {
      await cleanupGeneratedChangelogs([changelogPath], false);

      await expect(readFile(changelogPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe("shouldPreservePackageChangelogs", () => {
  it.each([
    { value: "true", expected: true },
    { value: "false", expected: false },
    { value: undefined, expected: false },
  ])("returns $expected for $value", ({ value, expected }) => {
    expect(shouldPreservePackageChangelogs(value)).toBe(expected);
  });
});

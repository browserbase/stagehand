import { describe, expect, it } from "vitest";
import { consolidateChangelog, formatPackageChangelog } from "./consolidate-changelogs.ts";

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

  it("inserts SDK releases ahead of the existing history", () => {
    expect(consolidateChangelog(rootChangelog, [typescriptSection, pythonSection]))
      .toBe(`# Stagehand

Release notes for the public SDKs.

## TypeScript SDK 4.1.0

### Minor Changes

- Add a feature.

## Python SDK 4.0.1

### Patch Changes

- Fix a bug.

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

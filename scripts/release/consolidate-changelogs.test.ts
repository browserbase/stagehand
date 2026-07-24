import { describe, expect, it } from "vite-plus/test";
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
});

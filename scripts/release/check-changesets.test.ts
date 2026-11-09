import { describe, expect, it } from "vitest";
import { validateChangeset } from "./check-changesets.ts";

describe("validateChangeset", () => {
  it.each([
    '"@browserbasehq/stagehand-go": patch',
    '{ "@browserbasehq/stagehand-go": patch }',
    '"@browserbasehq/stagehand-go": patch\n"@browserbasehq/stagehand": minor',
  ])("rejects Go release entries with maintenance instructions (%s)", (frontmatter) => {
    expect(() => validateChangeset(`---\n${frontmatter}\n---\nRelease notes\n`, "go.md")).toThrow(
      "go.md selects @browserbasehq/stagehand-go; prepare Go patches on v4-go without Changesets",
    );
  });

  it("accepts allowed packages and valid YAML comments", () => {
    expect(() =>
      validateChangeset(
        `---
"@browserbasehq/stagehand": minor # public TypeScript SDK
"@browserbasehq/stagehand-python": patch
"@browserbasehq/stagehand-extension": patch
"@browserbasehq/eve": minor
---

Release the SDKs.
`,
        "allowed.md",
      ),
    ).not.toThrow();
  });

  it("rejects non-versioned packages even when YAML comments are present", () => {
    expect(() =>
      validateChangeset(
        `---
"@browserbasehq/stagehand-docs": patch # private package
---

Do not release this package.
`,
        "forbidden.md",
      ),
    ).toThrow("forbidden.md selects non-versioned packages: @browserbasehq/stagehand-docs");
  });

  it("accepts Browse alone and rejects a combined CLI/SDK release", () => {
    expect(() =>
      validateChangeset('---\n"browse": minor\n---\nCLI release', "cli.md"),
    ).not.toThrow();
    expect(() =>
      validateChangeset(
        '---\n"browse": minor\n"@browserbasehq/stagehand": patch\n---\nCombined',
        "mixed.md",
      ),
    ).toThrow("must separate Browse and SDK releases");
  });

  it("rejects malformed frontmatter", () => {
    expect(() => validateChangeset("not a changeset", "invalid.md")).toThrow(
      "invalid.md does not contain valid changeset frontmatter",
    );
  });
});

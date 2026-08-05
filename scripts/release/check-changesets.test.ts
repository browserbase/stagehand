import { describe, expect, it } from "vitest";
import { validateChangeset } from "./check-changesets.ts";

describe("validateChangeset", () => {
  it("accepts allowed packages and valid YAML comments", () => {
    expect(() =>
      validateChangeset(
        `---
"@browserbasehq/stagehand": minor # public TypeScript SDK
"@browserbasehq/stagehand-python": patch
"@browserbasehq/stagehand-go": patch
"@browserbasehq/stagehand-extension": patch
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

  it("rejects malformed frontmatter", () => {
    expect(() => validateChangeset("not a changeset", "invalid.md")).toThrow(
      "invalid.md does not contain valid changeset frontmatter",
    );
  });
});

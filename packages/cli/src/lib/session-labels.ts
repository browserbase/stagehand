import { Flags } from "@oclif/core";

import { fail } from "./errors.js";

export const labelFlagOptions = {
  description: "One Browserbase label per --label. Repeat the flag for additional labels.",
  helpValue: "<name>",
  multiple: true,
  multipleNonGreedy: true,
} as const;

export const labelFlag = Flags.string(labelFlagOptions);

export function normalizeSessionLabels(labels: unknown): string[] {
  if (!Array.isArray(labels) || labels.some((value) => typeof value !== "string")) {
    fail(
      "Session labels must be an array of names. Use one --label per name or a labels array in --body/--stdin.",
    );
  }
  if (labels.length > 1000) fail("A session label request accepts at most 1,000 names.");
  return labels.map((value: string) => {
    const label = value.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, "");
    if (!label) fail("Session label names must not be blank.");
    if (label.includes("\0")) fail("Session label names must not contain NUL characters.");
    if (Array.from(label).length > 128) {
      fail("Session label names must contain at most 128 Unicode characters.");
    }
    return label;
  });
}

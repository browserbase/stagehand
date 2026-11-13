import { Flags } from "@oclif/core";

import { fail } from "./errors.js";

export const labelFlagOptions = {
  description: "One Browserbase label per --label. Repeat the flag for additional labels.",
  helpValue: "<name>",
  multiple: true,
  multipleNonGreedy: true,
} as const;

export const labelFlag = Flags.string(labelFlagOptions);

export function normalizeSessionLabels(labels: string[]): string[] {
  return labels.map((value) => {
    const label = value.trim();
    if (!label) fail("Session label names must not be blank.");
    if (label.includes("\0")) fail("Session label names must not contain NUL characters.");
    return label;
  });
}

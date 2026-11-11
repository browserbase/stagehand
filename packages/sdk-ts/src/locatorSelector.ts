import { LocatorSelectorSchema } from "@browserbasehq/stagehand-protocol/schemas";
import type { LocatorSelector } from "@browserbasehq/stagehand-protocol/types";

/**
 * Normalize SDK input without changing the interpretation of existing strings.
 * Structured values are validated as written: prefixes, quotes, whitespace, and
 * ">>" inside a value are not reinterpreted by this boundary.
 */
export function normalizeLocatorSelector(input: string | LocatorSelector): LocatorSelector {
  return LocatorSelectorSchema.parse(
    typeof input === "string" ? { type: "legacy", value: input } : input,
  );
}

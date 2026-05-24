import { describe, expect, it } from "vitest";

import { inferToolOutput } from "../../lib/v3/agent/utils/toolOutputEvidence.js";

describe("inferToolOutput", () => {
  it.each<[string, unknown, boolean, string | undefined]>([
    [
      "preserves raw results while normalizing top-level failure status",
      { success: false },
      false,
      undefined,
    ],
    [
      "normalizes one-level AI SDK output wrappers",
      {
        toolCallId: "call-1",
        output: { success: false, error: { message: "not found" } },
      },
      false,
      '{"message":"not found"}',
    ],
    [
      "handles isError and non-string errors",
      { isError: true, error: new Error("bad input") },
      false,
      "bad input",
    ],
    [
      "normalizes non-json error values",
      { error: Symbol("bad input") },
      false,
      "Symbol(bad input)",
    ],
    [
      "does not recursively treat page data as tool status",
      { data: { success: false, error: "page field" } },
      true,
      undefined,
    ],
  ])("%s", (_, result, ok, error) => {
    expect(inferToolOutput(result)).toEqual({
      ok,
      result,
      error,
    });
  });
});

import { describe, expect, it } from "vitest";

import { inferToolOutput } from "../../lib/v3/agent/utils/toolOutputEvidence.js";

describe("inferToolOutput", () => {
  it("preserves raw results while normalizing top-level failure status", () => {
    const result = { success: false };

    expect(inferToolOutput(result)).toEqual({
      ok: false,
      result,
      error: undefined,
    });
  });

  it("normalizes one-level AI SDK output wrappers", () => {
    const result = {
      toolCallId: "call-1",
      output: { success: false, error: { message: "not found" } },
    };

    expect(inferToolOutput(result)).toEqual({
      ok: false,
      result,
      error: '{"message":"not found"}',
    });
  });

  it("handles isError and non-string errors", () => {
    const result = { isError: true, error: new Error("bad input") };

    expect(inferToolOutput(result)).toEqual({
      ok: false,
      result,
      error: "bad input",
    });
  });

  it("normalizes non-json error values", () => {
    const result = { error: Symbol("bad input") };

    expect(inferToolOutput(result)).toEqual({
      ok: false,
      result,
      error: "Symbol(bad input)",
    });
  });

  it("does not recursively treat page data as tool status", () => {
    const result = { data: { success: false, error: "page field" } };

    expect(inferToolOutput(result)).toEqual({
      ok: true,
      result,
      error: undefined,
    });
  });
});

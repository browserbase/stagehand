import { describe, expect, it } from "vitest";

import { reportMastraResult } from "../src/agent.ts";

describe("mastra example result reporting", () => {
  it("returns the final text when the run completed", () => {
    expect(reportMastraResult({ status: "completed", finalText: "Example Domain" })).toBe(
      "Example Domain",
    );
  });

  it("throws on the step cap with the stop reason and last text", () => {
    expect(() =>
      reportMastraResult({
        status: "max_turns",
        stopReason: "step budget exhausted (20 steps)",
        finalText: "still looking",
      }),
    ).toThrow(
      "Agent did not finish (max_turns): step budget exhausted (20 steps)\nLast agent message: still looking",
    );
  });

  it("throws on sdk_error, falling back to the sanitized iteration error", () => {
    const key = `sk-${"a".repeat(40)}`;
    let message = "";
    try {
      reportMastraResult({
        status: "sdk_error",
        finalText: "",
        iterationError: new Error(`401 invalid key ${key}`),
      });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/^Agent did not finish \(sdk_error\): 401 invalid key/);
    expect(message).not.toContain(key);
    expect(message).not.toContain("Last agent message");
  });
});

import { describe, expect, it } from "vitest";
import { isTerminalDoneToolCall } from "../../lib/v3/agent/utils/doneToolCall.js";

describe("isTerminalDoneToolCall", () => {
  it("returns false for non-done tools", () => {
    expect(
      isTerminalDoneToolCall({
        toolName: "act",
        input: { taskComplete: true },
      }),
    ).toBe(false);
  });

  it("returns false for dynamic/invalid done calls", () => {
    expect(
      isTerminalDoneToolCall({
        toolName: "done",
        dynamic: true,
        invalid: true,
        input: { taskComplete: true },
      }),
    ).toBe(false);
  });

  it("returns false when taskComplete is false", () => {
    expect(
      isTerminalDoneToolCall({
        toolName: "done",
        input: { taskComplete: false },
      }),
    ).toBe(false);
  });

  it("returns false when input is not an object", () => {
    expect(
      isTerminalDoneToolCall({
        toolName: "done",
        input: "not-an-object",
      }),
    ).toBe(false);
  });

  it("returns true only for valid done calls with taskComplete=true", () => {
    expect(
      isTerminalDoneToolCall({
        toolName: "done",
        input: { taskComplete: true, reasoning: "all done" },
      }),
    ).toBe(true);
  });
});

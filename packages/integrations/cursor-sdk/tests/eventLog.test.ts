import { describe, expect, it } from "vitest";
import { logCursorEvent } from "../src/index.js";

function recordingLogger() {
  const lines: Array<{ level?: number; message: string }> = [];
  const push = (line: { level?: number; message: string }) => void lines.push(line);
  return { lines, logger: { log: push, warn: push, error: push } };
}

describe("cursor event log levels", () => {
  it("drops deltas, demotes routine events to debug and keeps failures visible", () => {
    const { lines, logger } = recordingLogger();
    logCursorEvent(logger, { type: "assistant_delta", text: "pa" });
    logCursorEvent(logger, { type: "system", subtype: "init" });
    logCursorEvent(logger, {
      type: "assistant",
      message: { content: [{ type: "text", text: "hi" }] },
    });
    logCursorEvent(logger, { type: "result", subtype: "success", result: "done" });
    logCursorEvent(logger, { type: "result", subtype: "error", result: "boom" });
    expect(lines.map((line) => [line.level, line.message])).toEqual([
      [2, "system event"],
      [2, "assistant: hi"],
      [2, "result: success"],
      [1, "result: error"],
    ]);
  });
});

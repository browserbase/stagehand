import { describe, expect, it } from "vitest";
import { logPiEvent } from "../src/index.js";

function recordingLogger() {
  const lines: Array<{ level?: number; message: string }> = [];
  const push = (line: { level?: number; message: string }) => void lines.push(line);
  return { lines, logger: { log: push, warn: push, error: push } };
}

describe("pi event log levels", () => {
  it("drops message updates and bare lifecycle markers", () => {
    const { lines, logger } = recordingLogger();
    for (const type of [
      "message_update",
      "tool_execution_update",
      "message_start",
      "tool_execution_start",
      "agent_start",
      "turn_start",
      "agent_end",
      "turn_end",
    ]) {
      logPiEvent(logger, { type, toolName: "run" });
    }
    expect(lines).toEqual([]);
  });

  it("demotes completed messages and tool results to debug and keeps tool errors visible", () => {
    const { lines, logger } = recordingLogger();
    logPiEvent(logger, {
      type: "message_end",
      message: { role: "assistant", content: [{ type: "text", text: "hi" }] },
    });
    logPiEvent(logger, { type: "tool_execution_end", toolName: "run", result: "ok" });
    logPiEvent(logger, { type: "tool_execution_end", toolName: "run", isError: true, result: "x" });
    expect(lines.map((line) => [line.level, line.message])).toEqual([
      [2, "assistant: hi"],
      [2, "tool_execution_end: run"],
      [1, "tool_execution_end: run"],
    ]);
  });
});

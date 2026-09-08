import { describe, expect, it } from "vitest";
import { logFxEvent } from "../src/index.js";

function recordingLogger() {
  const lines: Array<{ level?: number; message: string }> = [];
  const push = (line: { level?: number; message: string }) => void lines.push(line);
  return { lines, logger: { log: push, warn: push, error: push } };
}

describe("fx event log levels", () => {
  it("demotes routine events to debug and keeps failures visible", () => {
    const { lines, logger } = recordingLogger();
    logFxEvent(logger, { type: "assistant", text: "hi" });
    logFxEvent(logger, {
      type: "tool_step",
      assistant: "",
      tool_calls: [{ name: "run" }],
      tool_results: [{ tool_name: "run", status: "completed" }],
    });
    logFxEvent(logger, { type: "stderr", line: "loading plugins" });
    logFxEvent(logger, { type: "turn_committed", terminal_reason: "done" });
    logFxEvent(logger, { type: "stderr", line: "Error: could not reach MCP server" });
    logFxEvent(logger, {
      type: "tool_step",
      assistant: "",
      tool_calls: [{ name: "run" }],
      tool_results: [{ tool_name: "run", status: "error" }],
    });
    expect(lines.map((line) => [line.level, line.message])).toEqual([
      [2, "assistant: hi"],
      [2, "tools: run"],
      [2, "stderr: loading plugins"],
      [2, "turn committed: done"],
      [1, "stderr: Error: could not reach MCP server"],
      [1, "tools: run"],
    ]);
  });
});

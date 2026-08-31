import { describe, expect, it } from "vitest";
import { logCodexEvent } from "../src/index.js";

function recordingLogger() {
  const lines: Array<{ level?: number; message: string }> = [];
  const push = (line: { level?: number; message: string }) => void lines.push(line);
  return { lines, logger: { log: push, warn: push, error: push } };
}

describe("codex event log levels", () => {
  it("drops item updates and bare lifecycle starts, demotes completed items to debug", () => {
    const { lines, logger } = recordingLogger();
    logCodexEvent(logger, { type: "item.updated", item: { type: "agent_message", text: "par" } });
    logCodexEvent(logger, { type: "thread.started", thread_id: "t1" });
    logCodexEvent(logger, { type: "turn.started" });
    logCodexEvent(logger, {
      type: "item.started",
      item: { type: "mcp_tool_call", server: "stagehand", tool: "run" },
    });
    expect(lines).toEqual([]);

    logCodexEvent(logger, {
      type: "item.completed",
      item: { type: "mcp_tool_call", server: "stagehand", tool: "run", status: "completed" },
    });
    logCodexEvent(logger, { type: "turn.completed", usage: { input_tokens: 1 } });
    expect(lines.map((line) => [line.level, line.message])).toEqual([
      [2, "mcp: stagehand.run completed"],
      [2, "turn completed"],
    ]);
  });

  it("keeps failures visible", () => {
    const { lines, logger } = recordingLogger();
    logCodexEvent(logger, { type: "turn.failed", error: { message: "boom" } });
    logCodexEvent(logger, {
      type: "item.completed",
      item: { type: "mcp_tool_call", server: "stagehand", tool: "run", status: "failed" },
    });
    logCodexEvent(logger, { type: "item.completed", item: { type: "error", message: "bad" } });
    expect(lines.map((line) => line.level)).toEqual([1, 1, 1]);
  });
});

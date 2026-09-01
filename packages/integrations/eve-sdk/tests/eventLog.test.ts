import { describe, expect, it } from "vitest";
import { logEveEvent } from "../src/index.js";

function recordingLogger() {
  const lines: Array<{ level?: number; message: string }> = [];
  const push = (line: { level?: number; message: string }) => void lines.push(line);
  return { lines, logger: { log: push, warn: push, error: push } };
}

describe("eve event log levels", () => {
  it("drops deltas and bare lifecycle markers", () => {
    const { lines, logger } = recordingLogger();
    for (const type of ["message.delta", "step.started", "turn.started", "session.started"]) {
      logEveEvent(logger, { type, data: {} });
    }
    expect(lines).toEqual([]);
  });

  it("demotes completed steps and tool results to debug and keeps failures visible", () => {
    const { lines, logger } = recordingLogger();
    logEveEvent(logger, { type: "message.completed", data: { message: "done" } });
    logEveEvent(logger, {
      type: "action.result",
      data: { status: "completed", result: { toolName: "run" } },
    });
    logEveEvent(logger, { type: "step.completed", data: { usage: {} } });
    logEveEvent(logger, { type: "turn.failed", data: { message: "boom" } });
    expect(lines.map((line) => [line.level, line.message])).toEqual([
      [2, "agent: done"],
      [2, "tool: run completed"],
      [2, "step completed"],
      [1, "turn failed: boom"],
    ]);
  });
});

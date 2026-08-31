import { describe, expect, it } from "vitest";
import { logMastraEvent } from "../src/index.js";

function recordingLogger() {
  const lines: Array<{ level?: number; message: string }> = [];
  const push = (line: { level?: number; message: string }) => void lines.push(line);
  return { lines, logger: { log: push, warn: push, error: push } };
}

describe("mastra event log levels", () => {
  it("drops stream deltas and bare start/end markers", () => {
    const { lines, logger } = recordingLogger();
    for (const type of [
      "tool-call-delta",
      "reasoning-delta",
      "text-delta",
      "reasoning-start",
      "reasoning-end",
      "text-start",
      "text-end",
      "tool-call-input-streaming-start",
      "tool-call-input-streaming-end",
      "step-start",
    ]) {
      logMastraEvent(logger, { type, payload: { text: "x" } });
    }
    expect(lines).toEqual([]);
  });

  it("demotes tool calls, results and finishes to debug and keeps errors visible", () => {
    const { lines, logger } = recordingLogger();
    logMastraEvent(logger, {
      type: "tool-call",
      payload: { toolName: "stagehand_run", args: { code: "1" } },
    });
    logMastraEvent(logger, {
      type: "tool-result",
      payload: { toolName: "stagehand_run", result: "ok" },
    });
    logMastraEvent(logger, {
      type: "step-finish",
      payload: { stepResult: { reason: "tool-calls" } },
    });
    logMastraEvent(logger, {
      type: "tool-error",
      payload: { toolName: "stagehand_run", error: "nope" },
    });
    logMastraEvent(logger, { type: "error", payload: { error: "fatal" } });
    expect(lines.map((line) => [line.level, line.message])).toEqual([
      [2, 'tool: stagehand_run {"code":"1"}'],
      [2, "tool result: stagehand_run ok"],
      [2, "step-finish: tool-calls"],
      [1, "tool error: stagehand_run nope"],
      [1, "error: fatal"],
    ]);
  });
});

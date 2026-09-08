import { describe, expect, it } from "vitest";
import { logDeepagentsEvent } from "../src/index.js";

function recordingLogger() {
  const lines: Array<{ level?: number; message: string }> = [];
  const push = (line: { level?: number; message: string }) => void lines.push(line);
  return { lines, logger: { log: push, warn: push, error: push } };
}

describe("deepagents event log levels", () => {
  it("demotes routine events to debug and keeps errors visible", () => {
    const { lines, logger } = recordingLogger();
    logDeepagentsEvent(logger, { type: "message_delta", text: "pa" });
    logDeepagentsEvent(logger, { type: "assistant", text: "hi" });
    logDeepagentsEvent(logger, { type: "tool_result", server: "stagehand", name: "run", ok: true });
    logDeepagentsEvent(logger, { type: "usage", input_tokens: 1 });
    logDeepagentsEvent(logger, {
      type: "tool_result",
      server: "stagehand",
      name: "run",
      ok: false,
    });
    logDeepagentsEvent(logger, { type: "error", message: "boom" });
    expect(lines.map((line) => [line.level, line.message])).toEqual([
      [2, "assistant: hi"],
      [2, "tool: stagehand.run ok"],
      [2, "usage"],
      [1, "tool: stagehand.run error"],
      [1, "error: boom"],
    ]);
  });
});

import { describe, expect, it } from "vitest";
import { logClaudeCodeMessage } from "../src/index.js";

function recordingLogger() {
  const lines: Array<{ level?: number; message: string }> = [];
  const push = (line: { level?: number; message: string }) => void lines.push(line);
  return { lines, logger: { log: push, warn: push, error: push } };
}

describe("claude_code event log levels", () => {
  it("drops partial stream events and demotes routine messages to debug", () => {
    const { lines, logger } = recordingLogger();
    logClaudeCodeMessage(logger, { type: "stream_event", event: { type: "content_block_delta" } });
    expect(lines).toEqual([]);

    logClaudeCodeMessage(logger, { type: "system", subtype: "init" });
    logClaudeCodeMessage(logger, {
      type: "assistant",
      message: { content: [{ type: "text", text: "hello" }] },
    });
    logClaudeCodeMessage(logger, { type: "result", subtype: "success", result: "done" });
    expect(lines.map((line) => [line.level, line.message])).toEqual([
      [2, "system message"],
      [2, "assistant: hello"],
      [2, "result: success"],
    ]);
  });

  it("keeps failures visible", () => {
    const { lines, logger } = recordingLogger();
    logClaudeCodeMessage(logger, { type: "result", subtype: "error_max_turns", is_error: true });
    expect(lines).toEqual([
      expect.objectContaining({ level: 1, message: "result: error_max_turns" }),
    ]);
  });
});

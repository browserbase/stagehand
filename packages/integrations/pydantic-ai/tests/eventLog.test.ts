import { describe, expect, it } from "vitest";
import { logPydanticAiEvent } from "../src/index.js";

function recordingLogger() {
  const lines: Array<{ level?: number; message: string }> = [];
  const push = (line: { level?: number; message: string }) => void lines.push(line);
  return { lines, logger: { log: push, warn: push, error: push } };
}

describe("pydantic_ai event log levels", () => {
  it("demotes routine events to debug and keeps errors visible", () => {
    const { lines, logger } = recordingLogger();
    logPydanticAiEvent(logger, { type: "message_delta", text: "pa" });
    logPydanticAiEvent(logger, { type: "assistant", text: "hi" });
    logPydanticAiEvent(logger, { type: "tool_result", server: "stagehand", name: "run", ok: true });
    logPydanticAiEvent(logger, { type: "usage", input_tokens: 1 });
    logPydanticAiEvent(logger, {
      type: "tool_result",
      server: "stagehand",
      name: "run",
      ok: false,
    });
    logPydanticAiEvent(logger, { type: "error", message: "boom" });
    expect(lines.map((line) => [line.level, line.message])).toEqual([
      [2, "assistant: hi"],
      [2, "tool: stagehand.run ok"],
      [2, "usage"],
      [1, "tool: stagehand.run error"],
      [1, "error: boom"],
    ]);
  });
});

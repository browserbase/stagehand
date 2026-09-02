import { describe, expect, it, vi } from "vitest";
import {
  buildGrokBuildArgs,
  buildGrokBuildStopReason,
  extractGrokBuildToolCall,
  normalizeGrokBuildModel,
  parseGrokBuildStreamLine,
  readGrokBuildUsage,
  resolveGrokBuildBinary,
  runGrokBuildSession,
  type GrokBuildProcessRunner,
} from "../src/session.ts";

const logger = {
  log: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

describe("Grok Build CLI session", () => {
  it("builds a restricted one-shot CLI invocation", () => {
    expect(
      buildGrokBuildArgs({
        prompt: "do it",
        model: "grok-build",
        session: { cwd: "/workspace", maxTurns: 12, sandbox: "off" },
      }),
    ).toEqual([
      "-p",
      "do it",
      "--output-format",
      "streaming-json",
      "--always-approve",
      "--tools",
      "search_tool,use_tool",
      "--disallowed-tools",
      "Agent",
      "--no-plan",
      "--no-subagents",
      "--disable-web-search",
      "--cwd",
      "/workspace",
      "--model",
      "grok-build",
      "--max-turns",
      "12",
      "--sandbox",
      "off",
    ]);
  });

  it("resolves the binary and normalizes harness model ids", () => {
    expect(resolveGrokBuildBinary("/custom/grok")).toBe("/custom/grok");
    expect(normalizeGrokBuildModel("grok-build/auto")).toBeUndefined();
    expect(normalizeGrokBuildModel("xai/grok-build")).toBe("grok-build");
    expect(normalizeGrokBuildModel("grok-build")).toBe("grok-build");
  });

  it("parses native streaming events and tool updates", () => {
    expect(parseGrokBuildStreamLine("not-json")).toBeUndefined();
    expect(parseGrokBuildStreamLine('{"type":"text","data":"hi"}')).toEqual({
      type: "text",
      data: "hi",
    });
    expect(
      extractGrokBuildToolCall({
        type: "tool_call",
        toolCallId: "call-1",
        toolName: "stagehand__run",
        rawInput: { code: "return 1" },
      }),
    ).toEqual({
      callId: "call-1",
      subtype: "started",
      name: "stagehand__run",
      args: { code: "return 1" },
      ok: true,
    });
    expect(
      extractGrokBuildToolCall({
        type: "tool_call_update",
        toolCallId: "call-1",
        status: "completed",
        rawOutput: { value: 1 },
      }),
    ).toMatchObject({
      callId: "call-1",
      subtype: "completed",
      result: { value: 1 },
      ok: true,
    });
  });

  it("normalizes usage from the terminal end event", () => {
    expect(
      readGrokBuildUsage({
        type: "end",
        usage: {
          input_tokens: 10,
          cache_read_input_tokens: 20,
          cache_creation_input_tokens: 2,
          output_tokens: 5,
          reasoning_tokens: 3,
        },
      }),
    ).toEqual({
      inputTokens: 10,
      outputTokens: 5,
      cachedInputTokens: 20,
      cacheCreationInputTokens: 2,
      reasoningOutputTokens: 3,
      totalTokens: 37,
      reported: true,
    });
  });

  it("runs the stream, joins text, and reports usage and cost", async () => {
    const onToolResult = vi.fn();
    const result = await runGrokBuildSession({
      prompt: "do it",
      model: "grok-build/auto",
      logger,
      session: { cwd: "/workspace" },
      runProcess: scriptedRunner([
        { type: "text", data: "EVAL_RESULT: " },
        {
          type: "tool_call",
          toolCallId: "call-1",
          toolName: "stagehand__snapshot",
          rawInput: {},
        },
        {
          type: "tool_call_update",
          toolCallId: "call-1",
          status: "completed",
          rawOutput: "snapshot",
        },
        { type: "text", data: '{"success":true,"summary":"done","finalAnswer":"ok"}' },
        {
          type: "end",
          stopReason: "end_turn",
          usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
          total_cost_usd: 0.02,
          num_turns: 2,
        },
      ]),
      onToolResult,
    });

    expect(result.status).toBe("completed");
    expect(result.resultText).toContain('EVAL_RESULT: {"success":true');
    expect(result.tokenUsage.totalTokens).toBe(15);
    expect(result.costUsd).toBe(0.02);
    expect(onToolResult).toHaveBeenCalledWith(
      "stagehand__snapshot",
      expect.objectContaining({ subtype: "completed" }),
    );
  });

  it("fails a non-zero exit without an end event", async () => {
    const result = await runGrokBuildSession({
      prompt: "do it",
      model: "grok-build/auto",
      logger,
      session: {},
      runProcess: scriptedRunner([], 1),
    });
    expect(result.status).toBe("sdk_error");
    expect(result.stopReason).toContain("exited with code 1");
  });

  it("reports max-turn stops without treating them as SDK errors", () => {
    expect(
      buildGrokBuildStopReason({
        endEvent: { type: "end", stopReason: "max_turn_requests" },
        stderr: "",
      }),
    ).toBe("max turns reached");
  });
});

function scriptedRunner(
  events: Array<Record<string, unknown>>,
  exitCode = 0,
): GrokBuildProcessRunner {
  return async (input) => {
    for (const event of events) await input.onStdoutLine(JSON.stringify(event));
    return { exitCode, signal: null };
  };
}

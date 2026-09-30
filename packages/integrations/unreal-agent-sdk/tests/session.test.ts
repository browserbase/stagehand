import { describe, expect, it } from "vitest";
import {
  normalizeUnrealModel,
  parseUnrealEvents,
  runUnrealProcess,
  runUnrealSession,
} from "../src/session.js";

const response = JSON.stringify({
  Sequence: 4,
  Kind: "model_response",
  Data: {
    Response: {
      Output: [
        {
          Type: "tool_call",
          Data: { CallID: "c1", Name: "Bash", Arguments: '{"command":"facade snapshot"}' },
        },
        {
          Type: "message",
          Data: {
            Role: "assistant",
            Text: 'EVAL_RESULT: {"success":true,"summary":"done","finalAnswer":"done"}',
          },
        },
      ],
      Usage: { InputTokens: 12, CachedInputTokens: 3, OutputTokens: 5, ReasoningTokens: 1 },
    },
  },
});
const status = JSON.stringify({
  Sequence: 5,
  Kind: "tool_call_status",
  Data: { CallID: "c1", Status: { WaitingFor: ["o1"] } },
});

describe("Unreal Agent process adapter", () => {
  it("parses session JSONL and usage", () => {
    const parsed = parseUnrealEvents(`${response}\n${status}\n`);
    expect(parsed.finalMessage).toContain("EVAL_RESULT:");
    expect(parsed.toolCalls).toEqual([
      {
        id: "c1",
        name: "Bash",
        args: { command: "facade snapshot" },
        status: "submitted",
        result: undefined,
      },
    ]);
    expect(parsed.tokenUsage).toEqual({
      inputTokens: 12,
      cachedInputTokens: 3,
      outputTokens: 5,
      reasoningOutputTokens: 1,
    });
  });

  it("rejects malformed JSONL", () => {
    expect(() => parseUnrealEvents(`${response}\nnot-json`)).toThrow("line 2");
  });

  it("maps provider and model separately", () => {
    expect(normalizeUnrealModel("openai/gpt-6-luna")).toEqual({
      provider: "openai",
      model: "gpt-6-luna",
    });
    expect(() => normalizeUnrealModel("anthropic/claude")).toThrow("Unsupported");
  });

  it("passes the JSON request and reports nonzero exits", async () => {
    let request: Record<string, unknown> | undefined;
    const result = await runUnrealSession({
      prompt: "task",
      model: "openai/gpt-6-luna",
      workspace: "/tmp/unreal-test",
      env: {},
      runProcess: async (input) => {
        request = JSON.parse(input.stdin) as Record<string, unknown>;
        expect(input.env.UNREAL_HARNESS_LLM_PROVIDER).toBe("openai");
        return { stdout: `${response}\n`, stderr: "failed", exitCode: 1, aborted: false };
      },
    });
    expect(request).toMatchObject({ prompt: "task", model: "gpt-6-luna" });
    expect(result.status).toBe("sdk_error");
    expect(result.stopReason).toBe("failed");
  });

  it("marks an aborted process", async () => {
    const result = await runUnrealSession({
      prompt: "task",
      model: "openai/gpt-6-luna",
      workspace: "/tmp/unreal-test",
      env: {},
      runProcess: async () => ({ stdout: "", stderr: "", exitCode: null, aborted: true }),
    });
    expect(result.status).toBe("aborted");
  });

  it("terminates the real child process when aborted", async () => {
    const controller = new AbortController();
    const promise = runUnrealProcess({
      bin: process.execPath,
      args: ["-e", "setInterval(() => {}, 1000)"],
      cwd: process.cwd(),
      env: { ...process.env } as Record<string, string>,
      stdin: "",
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 50);
    const result = await promise;
    expect(result.aborted).toBe(true);
  });
});

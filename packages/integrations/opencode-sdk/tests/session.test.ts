import { describe, expect, it, vi } from "vitest";
import {
  buildOpenCodeTranscript,
  extractOpenCodeAssistantText,
  normalizeOpenCodeModel,
  normalizeOpenCodeUsage,
  runOpenCodeSession,
  type OpenCodeRuntime,
} from "../src/index.js";

const session = {
  config: { mcp: { servers: {} }, permissions: [] },
  directory: "/tmp/workspace",
  configRoot: "/tmp/config",
};
const logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };

function fakeRuntime(): OpenCodeRuntime {
  return {
    run: vi.fn(async () => ({
      messages: [
        {
          type: "assistant" as const,
          content: [
            { type: "reasoning", text: "Inspect the page" },
            {
              type: "tool",
              name: "stagehand_run",
              state: { status: "completed", input: {}, content: [{ type: "text", text: "1" }] },
            },
            { type: "text", text: "done" },
          ],
        },
      ],
      finalMessage: "done",
      status: "completed" as const,
      tokenUsage: normalizeOpenCodeUsage({
        input: 10,
        output: 4,
        reasoning: 2,
        cache: { read: 3, write: 1 },
      }),
      costUsd: 0.01,
    })),
    close: vi.fn(async () => undefined),
  };
}

describe("OpenCode v2 SDK session", () => {
  it("selects explicit models and preserves automatic selection", () => {
    expect(normalizeOpenCodeModel("openai/gpt-5.4-mini")).toEqual({
      providerID: "openai",
      id: "gpt-5.4-mini",
    });
    expect(normalizeOpenCodeModel("opencode/auto")).toBeUndefined();
    expect(() => normalizeOpenCodeModel("invalid")).toThrow("provider/model");
  });

  it("uses v2 assistant content and cumulative usage", () => {
    const messages = [
      {
        type: "assistant" as const,
        content: [
          { type: "reasoning", text: "private" },
          { type: "text", text: "Hello" },
          { type: "tool", name: "stagehand_run", state: { status: "completed", content: [] } },
          { type: "text", text: " world" },
        ],
      },
    ];
    expect(extractOpenCodeAssistantText(messages[0])).toBe("Hello world");
    expect(buildOpenCodeTranscript(messages)).toContain("[tool stagehand_run]");
    expect(
      normalizeOpenCodeUsage({ input: 10, output: 4, reasoning: 2, cache: { read: 3, write: 1 } }),
    ).toMatchObject({ totalTokens: 20, cachedInputTokens: 3, reported: true });
    expect(normalizeOpenCodeUsage(undefined).reported).toBe(false);
  });

  it("returns the run result and closes the worker", async () => {
    const runtime = fakeRuntime();
    const result = await runOpenCodeSession({
      prompt: "browse",
      model: "openai/gpt-5.4-mini",
      logger,
      session,
      startRuntime: async () => runtime,
    });
    expect(result.finalMessage).toBe("done");
    expect(result.costUsd).toBe(0.01);
    expect(runtime.run).toHaveBeenCalledWith({
      prompt: "browse",
      model: "openai/gpt-5.4-mini",
      signal: undefined,
    });
    expect(runtime.close).toHaveBeenCalledOnce();
  });

  it("injects the native system prompt into the isolated session config", async () => {
    const runtime = fakeRuntime();
    await runOpenCodeSession({
      prompt: "browse",
      model: "openai/gpt-5.4-mini",
      logger,
      session,
      systemPrompt: "Do not ask for clarification.",
      maxToolSteps: 12,
      startRuntime: async (options) => {
        expect(options.session.config.agents?.build?.system).toBe("Do not ask for clarification.");
        return runtime;
      },
    });
    expect(runtime.run).toHaveBeenCalledWith({
      prompt: "browse",
      model: "openai/gpt-5.4-mini",
      signal: undefined,
      maxToolSteps: 12,
    });
  });

  it("sanitizes failures and closes the worker", async () => {
    const runtime = fakeRuntime();
    vi.mocked(runtime.run).mockRejectedValue(
      new Error("OpenCode prompt failed with sk-abcdef1234567890."),
    );
    const result = await runOpenCodeSession({
      prompt: "browse",
      model: "opencode/auto",
      logger,
      session,
      startRuntime: async () => runtime,
    });
    expect(result.status).toBe("sdk_error");
    expect(result.stopReason).toBe("OpenCode prompt failed with sk-abcdef[redacted].");
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("1234567890");
    expect(runtime.close).toHaveBeenCalledOnce();
  });

  it("does not start a runtime for an already cancelled run", async () => {
    const startRuntime = vi.fn(async () => fakeRuntime());
    const result = await runOpenCodeSession({
      prompt: "browse",
      model: "opencode/auto",
      logger,
      session,
      signal: AbortSignal.abort(new Error("cancelled before startup")),
      startRuntime,
    });
    expect(startRuntime).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: "sdk_error", stopReason: "cancelled before startup" });
  });
});

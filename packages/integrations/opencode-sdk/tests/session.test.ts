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
    const runtime = fakeRuntime();
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
    expect(runtime.run).toBeDefined();
    expect(
      normalizeOpenCodeUsage({ input: 10, output: 4, reasoning: 2, cache: { read: 3, write: 1 } }),
    ).toMatchObject({ totalTokens: 16, cachedInputTokens: 3 });
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

  it("sanitizes failures and closes the worker", async () => {
    const runtime = fakeRuntime();
    vi.mocked(runtime.run).mockRejectedValue(new Error("OpenCode prompt failed."));
    const result = await runOpenCodeSession({
      prompt: "browse",
      model: "opencode/auto",
      logger,
      session,
      startRuntime: async () => runtime,
    });
    expect(result.status).toBe("sdk_error");
    expect(result.stopReason).toBe("OpenCode prompt failed.");
    expect(runtime.close).toHaveBeenCalledOnce();
  });
});

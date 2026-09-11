import { describe, expect, it, vi } from "vitest";
import {
  buildOpenCodeTranscript,
  normalizeOpenCodeModel,
  runOpenCodeSession,
  type OpenCodeRuntime,
} from "../src/index.js";

describe("OpenCode SDK session", () => {
  it("normalizes explicit models and keeps auto provider selection", () => {
    expect(normalizeOpenCodeModel("openai/gpt-5.4-mini")).toEqual({
      providerID: "openai",
      modelID: "gpt-5.4-mini",
    });
    expect(normalizeOpenCodeModel("opencode/auto")).toBeUndefined();
    expect(() => normalizeOpenCodeModel("invalid")).toThrow("provider/model");
  });

  it("returns assistant parts, usage, and cost while cleaning up", async () => {
    const deleteSession = vi.fn(async () => ({ data: true }));
    const close = vi.fn();
    const runtime: OpenCodeRuntime = {
      client: {
        session: {
          create: vi.fn(async () => ({ data: { id: "session-1" } })),
          prompt: vi.fn(async () => ({
            data: {
              info: {
                role: "assistant",
                cost: 0.01,
                tokens: {
                  input: 10,
                  output: 4,
                  reasoning: 2,
                  cache: { read: 3, write: 1 },
                },
              },
              parts: [
                { type: "reasoning", text: "Inspect the page" },
                {
                  type: "tool",
                  tool: "stagehand_run",
                  state: { status: "completed", input: { code: "return 1" }, output: "1" },
                },
                { type: "text", text: "done" },
              ],
            },
          })),
          abort: vi.fn(async () => ({ data: true })),
          delete: deleteSession,
        },
      },
      close,
    };
    const onToolResult = vi.fn();
    const result = await runOpenCodeSession({
      prompt: "browse",
      model: "openai/gpt-5.4-mini",
      logger: { log: () => undefined, warn: () => undefined, error: () => undefined },
      startRuntime: async () => runtime,
      session: {
        config: {},
        directory: "/tmp/workspace",
        configRoot: "/tmp/config",
      },
      onToolResult,
    });
    expect(result.status).toBe("completed");
    expect(result.finalMessage).toBe("done");
    expect(result.tokenUsage).toMatchObject({ totalTokens: 16, cachedInputTokens: 3 });
    expect(result.costUsd).toBe(0.01);
    expect(onToolResult).toHaveBeenCalledWith("stagehand_run", expect.any(Object));
    expect(buildOpenCodeTranscript(result.messages)).toContain("[tool stagehand_run]");
    expect(deleteSession).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });
});

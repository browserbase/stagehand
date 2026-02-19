import { describe, expect, it, vi } from "vitest";
import { actTool } from "../lib/v3/agent/tools/act.js";
import { extractTool } from "../lib/v3/agent/tools/extract.js";
import { fillFormTool } from "../lib/v3/agent/tools/fillform.js";
import type { V3 } from "../lib/v3/v3.js";

/**
 * Minimal mock of V3 that captures how tools pass `model` options
 * into v3.act(), v3.extract(), and v3.observe().
 */
function createMockV3() {
  const calls: { method: string; model: unknown }[] = [];

  const mock = {
    logger: vi.fn(),
    recordAgentReplayStep: vi.fn(),
    act: vi.fn(async (_instruction: unknown, options?: { model?: unknown }) => {
      calls.push({ method: "act", model: options?.model });
      return {
        success: true,
        message: "ok",
        actionDescription: "clicked",
        actions: [],
      };
    }),
    extract: vi.fn(
      async (
        _instruction: unknown,
        _schema: unknown,
        options?: { model?: unknown },
      ) => {
        calls.push({ method: "extract", model: options?.model });
        return { extraction: "data" };
      },
    ),
    observe: vi.fn(
      async (_instruction: unknown, options?: { model?: unknown }) => {
        calls.push({ method: "observe", model: options?.model });
        return [];
      },
    ),
    calls,
  };

  return mock as unknown as V3 & { calls: typeof calls };
}

describe("agent tools pass full executionModel config to v3 methods", () => {
  const modelConfig = {
    modelName: "openai/gpt-4o-mini",
    apiKey: "sk-test-key",
    baseURL: "https://custom.api",
  };

  it("actTool passes AgentModelConfig object to v3.act()", async () => {
    const v3 = createMockV3();
    const tool = actTool(v3, modelConfig);
    await tool.execute!(
      { action: "click the button" },
      {
        toolCallId: "t1",
        messages: [],
        abortSignal: new AbortController().signal,
      },
    );

    expect(v3.calls).toHaveLength(1);
    expect(v3.calls[0].method).toBe("act");
    expect(v3.calls[0].model).toBe(modelConfig);
  });

  it("extractTool passes AgentModelConfig object to v3.extract()", async () => {
    const v3 = createMockV3();
    const tool = extractTool(v3, modelConfig);
    await tool.execute!(
      { instruction: "get the title", schema: undefined },
      {
        toolCallId: "t2",
        messages: [],
        abortSignal: new AbortController().signal,
      },
    );

    expect(v3.calls).toHaveLength(1);
    expect(v3.calls[0].method).toBe("extract");
    expect(v3.calls[0].model).toBe(modelConfig);
  });

  it("fillFormTool passes AgentModelConfig object to v3.observe()", async () => {
    const v3 = createMockV3();
    const tool = fillFormTool(v3, modelConfig);
    await tool.execute!(
      { fields: [{ action: "type hello into name", value: "hello" }] },
      {
        toolCallId: "t3",
        messages: [],
        abortSignal: new AbortController().signal,
      },
    );

    expect(v3.calls).toHaveLength(1);
    expect(v3.calls[0].method).toBe("observe");
    expect(v3.calls[0].model).toBe(modelConfig);
  });

  it("actTool passes undefined when no executionModel is set", async () => {
    const v3 = createMockV3();
    const tool = actTool(v3, undefined);
    await tool.execute!(
      { action: "click the button" },
      {
        toolCallId: "t4",
        messages: [],
        abortSignal: new AbortController().signal,
      },
    );

    expect(v3.calls).toHaveLength(1);
    expect(v3.calls[0].model).toBeUndefined();
  });

  it("actTool passes plain string executionModel to v3.act()", async () => {
    const v3 = createMockV3();
    const tool = actTool(v3, "openai/gpt-4o-mini");
    await tool.execute!(
      { action: "click the button" },
      {
        toolCallId: "t5",
        messages: [],
        abortSignal: new AbortController().signal,
      },
    );

    expect(v3.calls).toHaveLength(1);
    expect(v3.calls[0].model).toBe("openai/gpt-4o-mini");
  });
});

describe("executionModel fallback logic", () => {
  // This mirrors the resolution in V3.prepareAgentExecution (v3.ts:1682):
  //   const resolvedExecutionModel = options?.executionModel ?? options?.model;
  function resolveExecutionModel(options?: {
    executionModel?: string | { modelName: string };
    model?: string | { modelName: string };
  }) {
    return options?.executionModel ?? options?.model;
  }

  it("prefers explicit executionModel over model", () => {
    const result = resolveExecutionModel({
      executionModel: "openai/gpt-4o-mini",
      model: "anthropic/claude-sonnet-4-20250514",
    });
    expect(result).toBe("openai/gpt-4o-mini");
  });

  it("falls back to model when executionModel is not set", () => {
    const modelConfig = {
      modelName: "anthropic/claude-sonnet-4-20250514",
      apiKey: "sk-test",
    };
    const result = resolveExecutionModel({ model: modelConfig });
    expect(result).toBe(modelConfig);
  });

  it("returns undefined when neither is set", () => {
    expect(resolveExecutionModel({})).toBeUndefined();
    expect(resolveExecutionModel(undefined)).toBeUndefined();
  });
});

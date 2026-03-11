import { describe, expect, it, vi } from "vitest";
import { fillFormTool } from "../../lib/v3/agent/tools/fillform.js";
import type { V3 } from "../../lib/v3/v3.js";

/**
 * Minimal mock of V3 that captures arguments passed to act().
 */
function createMockV3(
  observeResults: Array<{
    method: string;
    arguments: string[];
    elementId?: string;
    description?: string;
  }>,
) {
  const actCalls: Array<{
    method: string;
    arguments: string[];
  }> = [];

  const mock = {
    logger: vi.fn(),
    recordAgentReplayStep: vi.fn(),
    act: vi.fn(async (res: { method: string; arguments: string[] }) => {
      actCalls.push({ method: res.method, arguments: [...res.arguments] });
      return {
        success: true,
        message: "ok",
        actionDescription: "done",
        actions: [],
      };
    }),
    observe: vi.fn(async () => observeResults),
    actCalls,
  };

  return mock as unknown as V3 & { actCalls: typeof actCalls };
}

const toolCtx = {
  toolCallId: "t1",
  messages: [] as never[],
  abortSignal: new AbortController().signal,
};

describe("fillForm value override", () => {
  it("uses caller-provided values instead of LLM-hallucinated values", async () => {
    // observe() returns hallucinated placeholder values
    const v3 = createMockV3([
      {
        method: "fill",
        arguments: ["test@example.com"], // hallucinated!
        elementId: "0-395",
        description: "email field",
      },
      {
        method: "fill",
        arguments: ["password123"], // hallucinated!
        elementId: "0-396",
        description: "password field",
      },
    ]);

    const tool = fillFormTool(v3);
    await tool.execute!(
      {
        fields: [
          {
            action: "type email into email field",
            value: "user@example.org",
          },
          {
            action: "type password into password field",
            value: "s3cret!",
          },
        ],
      },
      toolCtx,
    );

    // With the fix applied, act() should receive the REAL values
    expect(v3.actCalls[0].arguments).toEqual(["user@example.org"]);
    expect(v3.actCalls[1].arguments).toEqual(["s3cret!"]);
  });

  it("does not override non-fill methods (e.g. click)", async () => {
    const v3 = createMockV3([
      {
        method: "click",
        arguments: [],
        elementId: "0-100",
        description: "click submit",
      },
    ]);

    const tool = fillFormTool(v3);
    await tool.execute!(
      {
        fields: [{ action: "click submit button", value: "ignored" }],
      },
      toolCtx,
    );

    // click method should NOT have its arguments overridden
    expect(v3.actCalls[0].arguments).toEqual([]);
  });

  it("handles interleaved non-fill actions (fillIndex alignment)", async () => {
    // observe() returns a click between two fills
    const v3 = createMockV3([
      { method: "click", arguments: [], description: "focus email" },
      { method: "fill", arguments: ["placeholder1"], description: "email" },
      { method: "fill", arguments: ["placeholder2"], description: "password" },
    ]);

    const tool = fillFormTool(v3);
    await tool.execute!(
      {
        fields: [
          { action: "type email", value: "real@email.com" },
          { action: "type password", value: "realPass" },
        ],
      },
      toolCtx,
    );

    // The fix should use a fillIndex counter so:
    // - click at i=0 is skipped
    // - first fill maps to fields[0].value
    // - second fill maps to fields[1].value
    expect(v3.actCalls[0].arguments).toEqual([]); // click unchanged
    expect(v3.actCalls[1].arguments).toEqual(["real@email.com"]);
    expect(v3.actCalls[2].arguments).toEqual(["realPass"]);
  });

  it("handles empty string value (clearing a field)", async () => {
    const v3 = createMockV3([
      {
        method: "fill",
        arguments: ["hallucinated"],
        description: "search box",
      },
    ]);

    const tool = fillFormTool(v3);
    await tool.execute!(
      {
        fields: [{ action: "clear the search box", value: "" }],
      },
      toolCtx,
    );

    // Empty string is a valid value (clearing a field) —
    // it should NOT fall back to the hallucinated value
    expect(v3.actCalls[0].arguments).toEqual([""]);
  });

  it("skips extra fills when observe returns more fills than fields", async () => {
    const v3 = createMockV3([
      { method: "fill", arguments: ["hal1"], description: "email" },
      { method: "fill", arguments: ["hal2"], description: "password" },
      { method: "fill", arguments: ["hal3"], description: "confirm password" },
    ]);

    const tool = fillFormTool(v3);
    await tool.execute!(
      {
        fields: [
          { action: "type email", value: "real@email.com" },
          { action: "type password", value: "realPass" },
        ],
      },
      toolCtx,
    );

    // Only the two matched fills should be acted on
    expect(v3.actCalls).toHaveLength(2);
    expect(v3.actCalls[0].arguments).toEqual(["real@email.com"]);
    expect(v3.actCalls[1].arguments).toEqual(["realPass"]);

    // Warning should be logged for the skipped fill
    expect(v3.logger).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "agent",
        message: expect.stringContaining(
          "more fill actions than provided fields",
        ),
      }),
    );
  });
});

import { describe, expect, it, vi } from "vitest";
import { NoObjectGeneratedError } from "ai";
import { actTool } from "../../lib/v3/agent/tools/act.js";
import { extractTool } from "../../lib/v3/agent/tools/extract.js";
import { fillFormTool } from "../../lib/v3/agent/tools/fillform.js";
import { V3AgentHandler } from "../../lib/v3/handlers/v3AgentHandler.js";
import type { V3 } from "../../lib/v3/v3.js";
import type { LLMClient } from "../../lib/v3/llm/LLMClient.js";

function createNoObjectGeneratedError(): NoObjectGeneratedError {
  return new NoObjectGeneratedError({
    message: "Invalid structured output: missing required fields",
    text: '{"invalidResponseShape":"missing required title field"}',
    response: {
      id: "resp_mock",
      timestamp: new Date(),
      modelId: "mock/stagehand-compat",
    } as never,
    usage: {
      inputTokens: 1,
      outputTokens: 1,
      totalTokens: 2,
    } as never,
    finishReason: "stop" as never,
  });
}

describe("structured output error propagation", () => {
  it("actTool rethrows NoObjectGeneratedError from v3.act()", async () => {
    const error = createNoObjectGeneratedError();
    const v3 = {
      logger: vi.fn(),
      act: vi.fn().mockRejectedValue(error),
      recordAgentReplayStep: vi.fn(),
    } as unknown as V3;

    const toolDef = actTool(v3);

    await expect(
      toolDef.execute?.({ action: "click the button" }, {} as never),
    ).rejects.toBe(error);
    expect(v3.recordAgentReplayStep).not.toHaveBeenCalled();
  });

  it("fillFormTool rethrows NoObjectGeneratedError from v3.observe()", async () => {
    const error = createNoObjectGeneratedError();
    const v3 = {
      logger: vi.fn(),
      observe: vi.fn().mockRejectedValue(error),
      act: vi.fn(),
      recordAgentReplayStep: vi.fn(),
    } as unknown as V3;

    const toolDef = fillFormTool(v3);

    await expect(
      toolDef.execute?.(
        {
          fields: [{ action: "type hello into the first name input" }],
        },
        {} as never,
      ),
    ).rejects.toBe(error);
    expect(v3.recordAgentReplayStep).not.toHaveBeenCalled();
  });

  it("extractTool rethrows NoObjectGeneratedError from v3.extract()", async () => {
    const error = createNoObjectGeneratedError();
    const v3 = {
      extract: vi.fn().mockRejectedValue(error),
    } as unknown as V3;

    const toolDef = extractTool(v3);

    await expect(
      toolDef.execute?.(
        {
          instruction: "extract the title",
          schema: {
            type: "object",
            properties: {
              title: { type: "string" },
            },
          },
        },
        {} as never,
      ),
    ).rejects.toBe(error);
  });

  it("V3AgentHandler.execute() rethrows NoObjectGeneratedError", async () => {
    const error = createNoObjectGeneratedError();
    const llmClient = {
      generateText: vi.fn().mockRejectedValue(error),
    } as unknown as LLMClient;

    const handler = new V3AgentHandler({} as V3, vi.fn(), llmClient);

    vi.spyOn(
      handler as unknown as { prepareAgent: () => Promise<unknown> },
      "prepareAgent",
    ).mockResolvedValue({
      options: { instruction: "describe the page" },
      maxSteps: 3,
      systemPrompt: "",
      allTools: {},
      messages: [{ role: "user", content: "describe the page" }],
      wrappedModel: {},
      initialPageUrl: "https://example.com",
    });

    await expect(handler.execute("describe the page")).rejects.toBe(error);
  });

  it("V3AgentHandler.execute() still returns a failed result for generic errors", async () => {
    const llmClient = {
      generateText: vi.fn().mockRejectedValue(new Error("boom")),
    } as unknown as LLMClient;

    const handler = new V3AgentHandler({} as V3, vi.fn(), llmClient);

    vi.spyOn(
      handler as unknown as { prepareAgent: () => Promise<unknown> },
      "prepareAgent",
    ).mockResolvedValue({
      options: { instruction: "describe the page" },
      maxSteps: 3,
      systemPrompt: "",
      allTools: {},
      messages: [{ role: "user", content: "describe the page" }],
      wrappedModel: {},
      initialPageUrl: "https://example.com",
    });

    await expect(handler.execute("describe the page")).resolves.toMatchObject({
      success: false,
      completed: false,
      message: "Failed to execute task: boom",
    });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const { writeTimestampedTxtFile, appendSummary } = vi.hoisted(() => ({
  writeTimestampedTxtFile: vi.fn(() => ({
    fileName: "agent_done_call.txt",
    timestamp: "20250705_120000",
  })),
  appendSummary: vi.fn(),
}));

vi.mock("../../lib/inferenceLogUtils.js", () => ({
  writeTimestampedTxtFile,
  appendSummary,
}));

const generateText = vi.hoisted(() => vi.fn());

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    generateText,
  };
});

import { handleDoneToolCall } from "../../lib/v3/agent/utils/handleDoneToolCall.js";

describe("handleDoneToolCall inference logging", () => {
  beforeEach(() => {
    writeTimestampedTxtFile.mockReset();
    appendSummary.mockReset();
    generateText.mockReset();
    writeTimestampedTxtFile
      .mockReturnValueOnce({
        fileName: "agent_done_call.txt",
        timestamp: "20250705_120000",
      })
      .mockReturnValueOnce({
        fileName: "agent_done_response.txt",
        timestamp: "20250705_120000",
      });
  });

  it("does not write inference files when logInferenceToFile is disabled", async () => {
    generateText.mockResolvedValueOnce({
      toolCalls: [
        {
          toolName: "done",
          input: {
            reasoning: "Clicked sign in",
            taskComplete: true,
          },
        },
      ],
      response: { messages: [] },
      usage: { inputTokens: 10, outputTokens: 5 },
    });

    await handleDoneToolCall({
      model: { modelId: "openai/gpt-4.1-mini" } as never,
      inputMessages: [{ role: "user", content: "history" }],
      instruction: "Sign in",
      logger: vi.fn(),
      logInferenceToFile: false,
    });

    expect(writeTimestampedTxtFile).not.toHaveBeenCalled();
  });

  it("writes agent_done files when the model returns plain text", async () => {
    generateText.mockResolvedValueOnce({
      toolCalls: [],
      text: "Could not finish with done tool",
      response: { messages: [] },
      usage: { inputTokens: 4, outputTokens: 2 },
    });

    await handleDoneToolCall({
      model: { modelId: "openai/gpt-4.1-mini" } as never,
      inputMessages: [{ role: "user", content: "history" }],
      instruction: "Sign in",
      logger: vi.fn(),
      logInferenceToFile: true,
    });

    expect(writeTimestampedTxtFile).toHaveBeenCalledWith(
      "agent_summary",
      "agent_done_call",
      expect.objectContaining({ modelCall: "agent_done" }),
    );
    expect(appendSummary).toHaveBeenCalledWith(
      "agent",
      expect.objectContaining({
        agent_inference_type: "agent_done",
        status: "completed",
      }),
    );
  });

  it("writes agent_done files when logInferenceToFile is enabled", async () => {
    generateText.mockResolvedValueOnce({
      toolCalls: [
        {
          toolName: "done",
          input: {
            reasoning: "Clicked sign in",
            taskComplete: true,
          },
        },
      ],
      response: { messages: [] },
      usage: { inputTokens: 10, outputTokens: 5 },
    });

    await handleDoneToolCall({
      model: { modelId: "openai/gpt-4.1-mini" } as never,
      inputMessages: [{ role: "user", content: "history" }],
      instruction: "Sign in",
      logger: vi.fn(),
      logInferenceToFile: true,
    });

    expect(writeTimestampedTxtFile).toHaveBeenCalledWith(
      "agent_summary",
      "agent_done_call",
      expect.objectContaining({ modelCall: "agent_done" }),
    );
    expect(appendSummary).toHaveBeenCalledWith(
      "agent",
      expect.objectContaining({
        agent_inference_type: "agent_done",
        status: "completed",
      }),
    );
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const { writeTimestampedTxtFile, appendSummary } = vi.hoisted(() => ({
  writeTimestampedTxtFile: vi.fn(() => ({
    fileName: "20250705_120000_agent_step_1_call.txt",
    timestamp: "20250705_120000",
  })),
  appendSummary: vi.fn(),
}));

vi.mock("../../lib/inferenceLogUtils.js", () => ({
  writeTimestampedTxtFile,
  appendSummary,
}));

import {
  completeAgentStepInference,
  failAgentStepInference,
  finalizePendingAgentSteps,
  logAgentRunStart,
  logAgentStepCall,
  logAgentStepSummary,
  mapCuaStepUsage,
  runCuaStepWithInferenceLogging,
  sanitizeForInferenceLog,
} from "../../lib/v3/agent/utils/agentInferenceLogger.js";

describe("agentInferenceLogger", () => {
  beforeEach(() => {
    writeTimestampedTxtFile.mockClear();
    appendSummary.mockClear();
    writeTimestampedTxtFile.mockReturnValue({
      fileName: "20250705_120000_agent_step_1_call.txt",
      timestamp: "20250705_120000",
    });
  });

  it("sanitizes short data:image URLs", () => {
    const shortUrl = "data:image/png;base64,AA==";
    const sanitized = sanitizeForInferenceLog({ image: shortUrl }) as {
      image: string;
    };
    expect(sanitized.image).toContain("[image omitted");
  });

  it("sanitizes base64 image payloads", () => {
    const payload = {
      screenshot: "data:image/png;base64," + "A".repeat(400),
      note: "hello",
    };

    const sanitized = sanitizeForInferenceLog(payload) as {
      screenshot: string;
      note: string;
    };

    expect(sanitized.note).toBe("hello");
    expect(sanitized.screenshot).toContain("[image omitted");
  });

  it("sanitizes class instances and buffers via JSON round-trip", () => {
    class MessagePart {
      constructor(public text: string) {}
    }

    const sanitized = sanitizeForInferenceLog({
      part: new MessagePart("hello"),
      buf:
        typeof Buffer !== "undefined"
          ? Buffer.from("abc")
          : new Uint8Array([1, 2, 3]),
    }) as { part: { text: string }; buf: string };

    expect(sanitized.part).toEqual({ text: "hello" });
    expect(sanitized.buf).toContain("omitted");
  });

  it("does not redact short data fields that are not base64 images", () => {
    const hash = "a".repeat(64);
    const sanitized = sanitizeForInferenceLog({ data: hash }) as {
      data: string;
    };
    expect(sanitized.data).toBe(hash);
  });

  it("writes run start files under agent_summary", () => {
    logAgentRunStart({
      instruction: "click login",
      mode: "dom",
      modelId: "openai/gpt-4.1-mini",
      tools: ["act", "extract"],
      agentType: "dom",
    });

    expect(writeTimestampedTxtFile).toHaveBeenCalledWith(
      "agent_summary",
      "agent_run_start",
      expect.objectContaining({
        modelCall: "agent",
        instruction: "click login",
      }),
    );
  });

  it("appends agent step summaries with token usage", () => {
    logAgentStepSummary({
      stepIndex: 2,
      callFile: "call.txt",
      responseFile: "response.txt",
      timestamp: "20250705_120001",
      usage: {
        prompt_tokens: 10,
        completion_tokens: 5,
        reasoning_tokens: 1,
        cached_input_tokens: 2,
        inference_time_ms: 99,
      },
    });

    expect(appendSummary).toHaveBeenCalledWith(
      "agent",
      expect.objectContaining({
        agent_inference_type: "agent_step",
        step: 2,
        LLM_input_file: "call.txt",
        LLM_output_file: "response.txt",
        prompt_tokens: 10,
        completion_tokens: 5,
      }),
    );
  });

  it("completes CUA step inference with sanitized payloads", () => {
    writeTimestampedTxtFile
      .mockReturnValueOnce({
        fileName: "call.txt",
        timestamp: "20250705_120002",
      })
      .mockReturnValueOnce({
        fileName: "response.txt",
        timestamp: "20250705_120002",
      });

    const call = logAgentStepCall({
      stepIndex: 1,
      payload: {
        modelId: "openai/computer-use-preview",
        request: {
          inputItems: [
            { type: "input_image", image_url: "data:image/png;base64,AAAA" },
          ],
        },
      },
    });

    completeAgentStepInference({
      stepIndex: 1,
      call: call!,
      responsePayload: {
        modelId: "openai/computer-use-preview",
        response: {
          actions: [{ type: "click" }],
          completed: false,
        },
      },
      usage: {
        prompt_tokens: 3,
        completion_tokens: 1,
      },
      agentInferenceType: "agent_cua_step",
    });

    expect(writeTimestampedTxtFile).toHaveBeenCalledTimes(2);
    expect(appendSummary).toHaveBeenCalledWith(
      "agent",
      expect.objectContaining({
        agent_inference_type: "agent_cua_step",
        step: 1,
      }),
    );
  });

  it("records failed steps with error status", () => {
    writeTimestampedTxtFile
      .mockReturnValueOnce({
        fileName: "call.txt",
        timestamp: "20250705_120003",
      })
      .mockReturnValueOnce({
        fileName: "response.txt",
        timestamp: "20250705_120003",
      });

    const call = logAgentStepCall({
      stepIndex: 3,
      payload: { messages: [] },
    });
    expect(call).not.toBeNull();

    failAgentStepInference({
      stepIndex: 3,
      call: call!,
      error: new Error("provider timeout"),
      agentInferenceType: "agent_cua_step",
    });

    expect(appendSummary).toHaveBeenCalledWith(
      "agent",
      expect.objectContaining({
        agent_inference_type: "agent_cua_step",
        status: "failed",
        error: "provider timeout",
      }),
    );
  });

  it("finalizes all pending step calls on abort", () => {
    writeTimestampedTxtFile.mockReturnValue({
      fileName: "call.txt",
      timestamp: "20250705_120004",
    });

    const pending = new Map();
    const call1 = logAgentStepCall({ stepIndex: 1, payload: {} });
    const call2 = logAgentStepCall({ stepIndex: 2, payload: {} });
    pending.set(1, call1);
    pending.set(2, call2);

    finalizePendingAgentSteps(pending, "aborted");

    expect(pending.size).toBe(0);
    expect(appendSummary).toHaveBeenCalledTimes(2);
    expect(appendSummary).toHaveBeenCalledWith(
      "agent",
      expect.objectContaining({ status: "failed", error: "aborted" }),
    );
  });

  it("maps CUA reasoning and cached tokens", () => {
    expect(
      mapCuaStepUsage({
        input_tokens: 10,
        output_tokens: 5,
        reasoning_tokens: 3,
        cached_input_tokens: 2,
      }),
    ).toEqual({
      prompt_tokens: 10,
      completion_tokens: 5,
      reasoning_tokens: 3,
      cached_input_tokens: 2,
      inference_time_ms: undefined,
    });
  });

  it("omits inference_time_ms when CUA usage does not include timing", () => {
    expect(mapCuaStepUsage({ input_tokens: 1, output_tokens: 2 })).toEqual({
      prompt_tokens: 1,
      completion_tokens: 2,
      reasoning_tokens: 0,
      cached_input_tokens: 0,
      inference_time_ms: undefined,
    });
  });

  it("defers CUA call logging until executeStep invokes logCall", async () => {
    writeTimestampedTxtFile
      .mockReturnValueOnce({
        fileName: "call.txt",
        timestamp: "20250705_120006",
      })
      .mockReturnValueOnce({
        fileName: "response.txt",
        timestamp: "20250705_120006",
      });

    const result = await runCuaStepWithInferenceLogging({
      logInferenceToFile: true,
      stepIndex: 2,
      modelId: "openai/computer-use-preview",
      executeStep: async (ctx) => {
        ctx?.logCall({ requestParams: { model: "test" } });
        return {
          actions: [{ type: "click" }],
          message: "clicked",
          completed: false,
          usage: { input_tokens: 2, output_tokens: 1, inference_time_ms: 5 },
        };
      },
    });

    expect(result.message).toBe("clicked");
    expect(writeTimestampedTxtFile).toHaveBeenCalledWith(
      "agent_summary",
      "agent_step_2_call",
      expect.objectContaining({
        request: { requestParams: { model: "test" } },
      }),
    );
  });

  it("runs CUA steps with inference logging via shared helper", async () => {
    writeTimestampedTxtFile
      .mockReturnValueOnce({
        fileName: "call.txt",
        timestamp: "20250705_120006",
      })
      .mockReturnValueOnce({
        fileName: "response.txt",
        timestamp: "20250705_120006",
      });

    const result = await runCuaStepWithInferenceLogging({
      logInferenceToFile: true,
      stepIndex: 1,
      modelId: "openai/computer-use-preview",
      callPayload: { inputItems: [] },
      executeStep: async () => ({
        actions: [{ type: "click" }],
        message: "clicked",
        completed: false,
        usage: { input_tokens: 2, output_tokens: 1, inference_time_ms: 5 },
      }),
    });

    expect(result.message).toBe("clicked");
    expect(appendSummary).toHaveBeenCalledWith(
      "agent",
      expect.objectContaining({
        agent_inference_type: "agent_cua_step",
        step: 1,
      }),
    );
  });

  it("does not append summary when response file write fails", async () => {
    writeTimestampedTxtFile
      .mockReturnValueOnce({
        fileName: "call.txt",
        timestamp: "20250705_120005",
      })
      .mockReturnValueOnce(null);

    const call = logAgentStepCall({ stepIndex: 5, payload: {} });
    completeAgentStepInference({
      stepIndex: 5,
      call: call!,
      responsePayload: { ok: true },
    });

    expect(writeTimestampedTxtFile).toHaveBeenCalledTimes(2);
    expect(appendSummary).not.toHaveBeenCalled();
  });

  it("completes step inference with timing when usage omits inference_time_ms", () => {
    writeTimestampedTxtFile
      .mockReturnValueOnce({
        fileName: "call.txt",
        timestamp: "20250705_120005",
      })
      .mockReturnValueOnce({
        fileName: "response.txt",
        timestamp: "20250705_120005",
      });

    const call = logAgentStepCall({ stepIndex: 4, payload: {} });
    completeAgentStepInference({
      stepIndex: 4,
      call: call!,
      responsePayload: { ok: true },
      usage: { prompt_tokens: 1, completion_tokens: 1 },
      agentInferenceType: "agent_step",
    });

    expect(appendSummary).toHaveBeenCalledWith(
      "agent",
      expect.objectContaining({
        inference_time_ms: expect.any(Number),
      }),
    );
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { V3AgentHandler } from "../lib/v3/handlers/v3AgentHandler";
import type { V3 } from "../lib/v3/v3";
import type { LLMClient } from "../lib/v3/llm/LLMClient";
import type { ClientOptions } from "../lib/v3/types/public/model";

/**
 * Regression test for: Streaming onFinish Promise Chain Missing Error Handler
 *
 * BUG: In stream(), the onFinish callback calls ensureClosed().then()
 * without a .catch() handler. If ensureClosed() rejects, the result promise hangs
 * forever instead of rejecting.
 *
 * FIX: Add .catch((err) => rejectResult(err)) to the promise chain.
 *
 * This test:
 * - On main (without fix): FAILS with timeout because result promise hangs
 * - With fix: PASSES because result promise properly rejects
 */
describe("V3AgentHandler streaming onFinish error handling", () => {
  let capturedOnFinish: ((event: any) => void) | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    capturedOnFinish = null;
  });

  it("rejects result promise when ensureClosed fails in onFinish callback", async () => {
    const ensureClosedError = new Error("ensureClosed failure");

    // Mock V3 instance
    const mockV3 = {
      context: {
        awaitActivePage: vi.fn().mockResolvedValue({
          url: () => "https://example.com",
        }),
      },
    } as unknown as V3;

    // Mock logger
    const mockLogger = vi.fn();

    // Mock LLM client with streamText that captures onFinish
    const mockLLMClient = {
      type: "openai",
      modelName: "gpt-4o",
      clientOptions: {} as ClientOptions,
      streamText: vi.fn((options: any) => {
        // Capture the onFinish callback so we can trigger it manually
        capturedOnFinish = options.onFinish;
        return {
          fullStream: (async function* () {
            yield { type: "text-delta", textDelta: "test" };
          })(),
        };
      }),
    } as unknown as LLMClient;

    // Create handler with correct parameter order: v3, logger, llmClient, executionModel
    const handler = new V3AgentHandler(
      mockV3,
      mockLogger,
      mockLLMClient,
      "gpt-4o",
    );

    // Mock ensureClosed to reject - this simulates the error condition
    vi.spyOn(handler as any, "ensureClosed").mockRejectedValue(ensureClosedError);

    // Mock prepareAgent to return valid data so stream() can proceed
    vi.spyOn(handler as any, "prepareAgent").mockResolvedValue({
      options: { instruction: "test", maxSteps: 1 },
      maxSteps: 1,
      systemPrompt: "system prompt",
      allTools: {},
      messages: [],
      wrappedModel: { modelId: "gpt-4o" },
      initialPageUrl: "https://example.com",
    });
    vi.spyOn(handler as any, "createPrepareStep").mockReturnValue(() => ({}));
    vi.spyOn(handler as any, "createStepHandler").mockReturnValue(() => {});
    vi.spyOn(handler as any, "handleStop").mockReturnValue(false);

    // Call the real stream() method - this sets up the promise chain we're testing
    const streamResult = await handler.stream({
      instruction: "test",
      maxSteps: 1,
    });

    // Verify onFinish was captured
    expect(capturedOnFinish).not.toBeNull();

    // Trigger onFinish - this is where the bug manifests
    // In the buggy code: ensureClosed().then() has no .catch(), so rejection is unhandled
    // In the fixed code: .catch() properly rejects the result promise
    capturedOnFinish!({
      response: { messages: [] },
      text: "done",
    });

    // Race against timeout to detect hanging promise
    const timeoutMs = 500;
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(
        () => reject(new Error("TIMEOUT: result promise hung - missing .catch() handler")),
        timeoutMs,
      );
    });

    // WITHOUT FIX: Promise.race will timeout because streamResult.result never settles
    // WITH FIX: streamResult.result rejects with ensureClosedError
    await expect(
      Promise.race([streamResult.result, timeoutPromise])
    ).rejects.toThrow("ensureClosed failure");
  });

  it("resolves result promise when ensureClosed succeeds", async () => {
    const mockCloseResult = {
      messages: [],
      output: { success: true },
    };

    const mockV3 = {
      context: {
        awaitActivePage: vi.fn().mockResolvedValue({
          url: () => "https://example.com",
        }),
      },
    } as unknown as V3;

    const mockLogger = vi.fn();

    const mockLLMClient = {
      type: "openai",
      modelName: "gpt-4o",
      clientOptions: {} as ClientOptions,
      streamText: vi.fn((options: any) => {
        capturedOnFinish = options.onFinish;
        return {
          fullStream: (async function* () {
            yield { type: "text-delta", textDelta: "test" };
          })(),
        };
      }),
    } as unknown as LLMClient;

    const handler = new V3AgentHandler(
      mockV3,
      mockLogger,
      mockLLMClient,
      "gpt-4o",
    );

    vi.spyOn(handler as any, "ensureClosed").mockResolvedValue(mockCloseResult);
    vi.spyOn(handler as any, "consolidateMetricsAndResult").mockReturnValue({
      success: true,
      message: "completed",
      actions: [],
    });
    vi.spyOn(handler as any, "prepareAgent").mockResolvedValue({
      options: { instruction: "test", maxSteps: 1 },
      maxSteps: 1,
      systemPrompt: "system prompt",
      allTools: {},
      messages: [],
      wrappedModel: { modelId: "gpt-4o" },
      initialPageUrl: "https://example.com",
    });
    vi.spyOn(handler as any, "createPrepareStep").mockReturnValue(() => ({}));
    vi.spyOn(handler as any, "createStepHandler").mockReturnValue(() => {});
    vi.spyOn(handler as any, "handleStop").mockReturnValue(false);

    const streamResult = await handler.stream({
      instruction: "test",
      maxSteps: 1,
    });

    capturedOnFinish!({
      response: { messages: [] },
      text: "done",
    });

    const result = await streamResult.result;
    expect(result.success).toBe(true);
  });
});

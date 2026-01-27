/**
 * BUG-019: Stream Continues After stagehand.close()
 *
 * Regression test to verify that the agent handler properly checks if
 * stagehand was closed during streaming and handles it gracefully.
 *
 * The fix adds ensureNotClosed() checks in v3AgentHandler.ts that mirror
 * the existing pattern in v3CuaAgentHandler.ts.
 *
 * Behavior:
 * - In execute(): StagehandClosedError is caught and returns a failure result
 * - In stream(): StagehandClosedError propagates to reject the stream
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { V3AgentHandler } from "../lib/v3/handlers/v3AgentHandler";
import { StagehandClosedError } from "../lib/v3/types/public/sdkErrors";
import type { V3 } from "../lib/v3/v3";
import type { LLMClient } from "../lib/v3/llm/LLMClient";
import type { LogLine } from "../lib/v3/types/public/logs";

describe("BUG-019: Stream close cleanup - ensureNotClosed checks", () => {
  let mockV3: V3;
  let mockLlmClient: LLMClient;
  let mockLogger: (message: LogLine) => void;

  beforeEach(() => {
    mockLogger = vi.fn();
    mockLlmClient = {
      getLanguageModel: vi.fn().mockReturnValue({
        modelId: "test-model",
        provider: "test",
      }),
      generateText: vi.fn(),
      streamText: vi.fn(),
    } as unknown as LLMClient;
  });

  describe("when stagehand context is null (closed)", () => {
    beforeEach(() => {
      // Simulate closed stagehand - context is null
      mockV3 = {
        context: null,
        logger: mockLogger,
        isBrowserbase: false,
        updateMetrics: vi.fn(),
        bus: { emit: vi.fn() },
      } as unknown as V3;
    });

    it("returns failure result with StagehandClosedError message when execute is called after close", async () => {
      const handler = new V3AgentHandler(
        mockV3,
        mockLogger,
        mockLlmClient,
        undefined,
        undefined,
        undefined,
        "dom",
      );

      // Execute catches the error and returns a failure result
      const result = await handler.execute({ instruction: "test instruction" });

      expect(result.success).toBe(false);
      expect(result.completed).toBe(false);
      expect(result.message).toContain("Stagehand session was closed");
    });

    it("includes correct error message in failure result", async () => {
      const handler = new V3AgentHandler(
        mockV3,
        mockLogger,
        mockLlmClient,
        undefined,
        undefined,
        undefined,
        "dom",
      );

      const result = await handler.execute({ instruction: "test instruction" });

      expect(result.message).toBe(
        "Failed to execute task: Stagehand session was closed",
      );
    });

    it("throws StagehandClosedError in stream mode when context is closed", async () => {
      const handler = new V3AgentHandler(
        mockV3,
        mockLogger,
        mockLlmClient,
        undefined,
        undefined,
        undefined,
        "dom",
      );

      // Stream mode throws the error directly in prepareAgent
      await expect(
        handler.stream({ instruction: "test instruction" }),
      ).rejects.toThrow(StagehandClosedError);
    });
  });

  describe("when stagehand context is available (not closed)", () => {
    beforeEach(() => {
      // Simulate active stagehand - context exists
      mockV3 = {
        context: {
          awaitActivePage: vi.fn().mockResolvedValue({
            url: vi.fn().mockReturnValue("https://example.com"),
            enableCursorOverlay: vi.fn().mockResolvedValue(undefined),
          }),
        },
        logger: mockLogger,
        isBrowserbase: false,
        updateMetrics: vi.fn(),
        bus: { emit: vi.fn() },
      } as unknown as V3;
    });

    it("does not fail with closed error when context is available", async () => {
      const handler = new V3AgentHandler(
        mockV3,
        mockLogger,
        mockLlmClient,
        undefined,
        undefined,
        undefined,
        "dom",
      );

      // Mock the generateText to return a successful result
      vi.mocked(mockLlmClient.generateText).mockResolvedValue({
        text: "done",
        usage: { inputTokens: 10, outputTokens: 5 },
        response: { messages: [] },
        steps: [],
      } as never);

      const result = await handler.execute({ instruction: "test instruction" });

      // Should not contain the "closed" error message
      expect(result.message).not.toContain("Stagehand session was closed");
    });
  });

  describe("context becomes null during execution", () => {
    it("handles context being cleared mid-step gracefully", async () => {
      // Start with context available
      const mockContext = {
        awaitActivePage: vi.fn().mockResolvedValue({
          url: vi.fn().mockReturnValue("https://example.com"),
          enableCursorOverlay: vi.fn().mockResolvedValue(undefined),
        }),
      };

      mockV3 = {
        context: mockContext,
        logger: mockLogger,
        isBrowserbase: false,
        updateMetrics: vi.fn(),
        bus: { emit: vi.fn() },
      } as unknown as V3;

      const handler = new V3AgentHandler(
        mockV3,
        mockLogger,
        mockLlmClient,
        undefined,
        undefined,
        undefined,
        "dom",
      );

      // Mock generateText to simulate the context being cleared during execution
      vi.mocked(mockLlmClient.generateText).mockImplementation(
        async (options) => {
          // Clear context mid-execution (simulating stagehand.close())
          (mockV3 as { context: unknown }).context = null;

          // Call onStepFinish which should now throw StagehandClosedError
          if (options.onStepFinish) {
            try {
              await options.onStepFinish({
                finishReason: "tool-calls",
                toolCalls: [{ toolName: "act", input: {} }],
                toolResults: [],
                text: "",
              } as never);
            } catch (error) {
              // The StagehandClosedError should be thrown here
              throw error;
            }
          }

          return {
            text: "done",
            usage: { inputTokens: 0, outputTokens: 0 },
            response: { messages: [] },
            steps: [],
          } as never;
        },
      );

      const result = await handler.execute({ instruction: "test instruction" });

      // Should detect closed state and return failure
      expect(result.success).toBe(false);
      expect(result.message).toContain("Stagehand session was closed");
    });
  });

  describe("StagehandClosedError is properly constructed", () => {
    it("StagehandClosedError extends Error and has correct message", () => {
      const error = new StagehandClosedError();

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(StagehandClosedError);
      expect(error.message).toBe("Stagehand session was closed");
    });
  });
});

describe("BUG-019 regression: comparison with v3CuaAgentHandler pattern", () => {
  it("v3AgentHandler properly handles closed context like v3CuaAgentHandler", async () => {
    // This test documents that the fix was applied
    // The V3AgentHandler class should detect when context is null
    // and handle it the same way v3CuaAgentHandler does

    const mockV3 = {
      context: null, // Closed
      logger: vi.fn(),
      isBrowserbase: false,
    } as unknown as V3;

    const mockLlmClient = {
      getLanguageModel: vi.fn().mockReturnValue({
        modelId: "test-model",
        provider: "test",
      }),
    } as unknown as LLMClient;

    const handler = new V3AgentHandler(
      mockV3,
      vi.fn(),
      mockLlmClient,
      undefined,
      undefined,
      undefined,
      "dom",
    );

    // Execute should return failure result with closed error
    const result = await handler.execute({ instruction: "test" });
    expect(result.success).toBe(false);
    expect(result.message).toContain("Stagehand session was closed");

    // Stream should throw StagehandClosedError
    await expect(handler.stream({ instruction: "test" })).rejects.toThrow(
      StagehandClosedError,
    );
  });
});

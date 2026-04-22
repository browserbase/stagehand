import { describe, expect, it, vi, beforeEach } from "vitest";
import { AnthropicCUAClient } from "../../lib/v3/agent/AnthropicCUAClient.js";
import Anthropic from "@anthropic-ai/sdk";

// Mock the Anthropic SDK's beta.messages.create method
vi.mock("@anthropic-ai/sdk", () => {
  const mockCreate = vi.fn().mockResolvedValue({
    id: "test-id",
    content: [{ type: "text", text: "test response" }],
    usage: { input_tokens: 10, output_tokens: 20 },
  });

  return {
    default: class MockAnthropic {
      beta = {
        messages: {
          create: mockCreate,
        },
      };
    },
  };
});

describe("AnthropicCUAClient adaptive thinking", () => {
  let mockCreate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    // Get the mock create function from a new instance
    const anthropic = new Anthropic({ apiKey: "test" });
    mockCreate = anthropic.beta.messages.create as ReturnType<typeof vi.fn>;
    mockCreate.mockResolvedValue({
      id: "test-id",
      content: [{ type: "text", text: "test response" }],
      usage: { input_tokens: 10, output_tokens: 20 },
    });
  });

  describe("Claude 4.6 models (adaptive thinking)", () => {
    it("should use thinking.type: 'adaptive' for claude-opus-4-6 when thinkingEffort is set", async () => {
      const client = new AnthropicCUAClient(
        "anthropic",
        "claude-opus-4-6",
        undefined,
        {
          apiKey: "test-key",
          thinkingEffort: "high",
        },
      );
      client.setViewport(1280, 720);

      await client.getAction([{ role: "user", content: "test" }]);

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          thinking: { type: "adaptive" },
          output_config: { effort: "high" },
          temperature: 1,
        }),
      );

      // Should NOT have budget_tokens
      const callArgs = mockCreate.mock.calls[0][0];
      expect(callArgs.thinking).not.toHaveProperty("budget_tokens");
    });

    it("should use thinking.type: 'adaptive' for claude-sonnet-4-6 when thinkingEffort is set", async () => {
      const client = new AnthropicCUAClient(
        "anthropic",
        "claude-sonnet-4-6",
        undefined,
        {
          apiKey: "test-key",
          thinkingEffort: "medium",
        },
      );
      client.setViewport(1280, 720);

      await client.getAction([{ role: "user", content: "test" }]);

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          thinking: { type: "adaptive" },
          output_config: { effort: "medium" },
          temperature: 1,
        }),
      );
    });

    it("should support 'max' effort level for claude-opus-4-6", async () => {
      const client = new AnthropicCUAClient(
        "anthropic",
        "claude-opus-4-6",
        undefined,
        {
          apiKey: "test-key",
          thinkingEffort: "max",
        },
      );
      client.setViewport(1280, 720);

      await client.getAction([{ role: "user", content: "test" }]);

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          thinking: { type: "adaptive" },
          output_config: { effort: "max" },
          temperature: 1,
        }),
      );
    });

    it("should support 'low' effort level", async () => {
      const client = new AnthropicCUAClient(
        "anthropic",
        "claude-sonnet-4-6",
        undefined,
        {
          apiKey: "test-key",
          thinkingEffort: "low",
        },
      );
      client.setViewport(1280, 720);

      await client.getAction([{ role: "user", content: "test" }]);

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          thinking: { type: "adaptive" },
          output_config: { effort: "low" },
          temperature: 1,
        }),
      );
    });

    it("should default to adaptive thinking with 'medium' effort when thinkingEffort is not set for 4.6 models", async () => {
      const client = new AnthropicCUAClient(
        "anthropic",
        "claude-opus-4-6",
        undefined,
        {
          apiKey: "test-key",
        },
      );
      client.setViewport(1280, 720);

      await client.getAction([{ role: "user", content: "test" }]);

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          thinking: { type: "adaptive" },
          output_config: { effort: "medium" },
          temperature: 1,
        }),
      );
    });

    it("should set temperature to 1 when adaptive thinking is enabled", async () => {
      const client = new AnthropicCUAClient(
        "anthropic",
        "claude-opus-4-6",
        undefined,
        {
          apiKey: "test-key",
          thinkingEffort: "high",
        },
      );
      client.setViewport(1280, 720);

      await client.getAction([{ role: "user", content: "test" }]);

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          temperature: 1,
        }),
      );
    });

    it("should set temperature to 1 for claude-sonnet-4-6 with adaptive thinking", async () => {
      const client = new AnthropicCUAClient(
        "anthropic",
        "claude-sonnet-4-6",
        undefined,
        {
          apiKey: "test-key",
          thinkingEffort: "low",
        },
      );
      client.setViewport(1280, 720);

      await client.getAction([{ role: "user", content: "test" }]);

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          thinking: { type: "adaptive" },
          output_config: { effort: "low" },
          temperature: 1,
        }),
      );
    });

    it("should disable adaptive thinking when thinkingEffort is 'none'", async () => {
      const client = new AnthropicCUAClient(
        "anthropic",
        "claude-opus-4-6",
        undefined,
        {
          apiKey: "test-key",
          thinkingEffort: "none",
        },
      );
      client.setViewport(1280, 720);

      await client.getAction([{ role: "user", content: "test" }]);

      const callArgs = mockCreate.mock.calls[0][0];
      expect(callArgs.thinking).toBeUndefined();
      expect(callArgs.output_config).toBeUndefined();
      expect(callArgs.temperature).toBeUndefined();
    });

    it("should log a debug warning when thinkingBudget is set on a 4.6 model", async () => {
      const logger = vi.fn();

      const client = new AnthropicCUAClient(
        "anthropic",
        "claude-opus-4-6",
        undefined,
        {
          apiKey: "test-key",
          thinkingBudget: 10000,
        },
      );
      client.setViewport(1280, 720);

      await client.getAction([{ role: "user", content: "test" }], logger);

      expect(logger).toHaveBeenCalledWith(
        expect.objectContaining({
          category: "agent",
          message: expect.stringContaining("thinkingBudget is ignored"),
          level: 2,
        }),
      );

      // Should still use adaptive thinking, not budget_tokens
      const callArgs = mockCreate.mock.calls[0][0];
      expect(callArgs.thinking).toEqual({ type: "adaptive" });
    });

    it("should log a debug warning when user-specified temperature is overridden", async () => {
      const logger = vi.fn();

      const client = new AnthropicCUAClient(
        "anthropic",
        "claude-opus-4-6",
        undefined,
        {
          apiKey: "test-key",
          thinkingEffort: "high",
          temperature: 0.5,
        },
      );
      client.setViewport(1280, 720);

      await client.getAction([{ role: "user", content: "test" }], logger);

      expect(logger).toHaveBeenCalledWith(
        expect.objectContaining({
          category: "agent",
          message: expect.stringContaining(
            "overriding user-specified temperature=0.5",
          ),
          level: 2,
        }),
      );

      // Temperature should still be forced to 1
      const callArgs = mockCreate.mock.calls[0][0];
      expect(callArgs.temperature).toBe(1);
    });
  });

  describe("older Claude models (budget_tokens - deprecated)", () => {
    it("should use thinking.type: 'enabled' with budget_tokens for claude-sonnet-4-5 when thinkingBudget is set", async () => {
      const client = new AnthropicCUAClient(
        "anthropic",
        "claude-sonnet-4-5-20250929",
        undefined,
        {
          apiKey: "test-key",
          thinkingBudget: 8000,
        },
      );
      client.setViewport(1280, 720);

      await client.getAction([{ role: "user", content: "test" }]);

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          thinking: { type: "enabled", budget_tokens: 8000 },
        }),
      );

      // Should NOT have output_config for older models
      const callArgs = mockCreate.mock.calls[0][0];
      expect(callArgs.output_config).toBeUndefined();
    });

    it("should use thinking.type: 'enabled' with budget_tokens for claude-opus-4-5 when thinkingBudget is set", async () => {
      const client = new AnthropicCUAClient(
        "anthropic",
        "claude-opus-4-5-20251101",
        undefined,
        {
          apiKey: "test-key",
          thinkingBudget: 10000,
        },
      );
      client.setViewport(1280, 720);

      await client.getAction([{ role: "user", content: "test" }]);

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          thinking: { type: "enabled", budget_tokens: 10000 },
        }),
      );
    });

    it("should NOT force temperature to 1 for older models with budget_tokens", async () => {
      const client = new AnthropicCUAClient(
        "anthropic",
        "claude-sonnet-4-5-20250929",
        undefined,
        {
          apiKey: "test-key",
          thinkingBudget: 8000,
        },
      );
      client.setViewport(1280, 720);

      await client.getAction([{ role: "user", content: "test" }]);

      const callArgs = mockCreate.mock.calls[0][0];
      // Temperature should not be explicitly set to 1 for older models
      expect(callArgs.temperature).toBeUndefined();
    });
  });

  describe("model detection", () => {
    it("should detect claude-opus-4-6 as a 4.6 model", async () => {
      const client = new AnthropicCUAClient(
        "anthropic",
        "claude-opus-4-6",
        undefined,
        {
          apiKey: "test-key",
          thinkingEffort: "high",
        },
      );
      client.setViewport(1280, 720);

      await client.getAction([{ role: "user", content: "test" }]);

      const callArgs = mockCreate.mock.calls[0][0];
      expect(callArgs.thinking.type).toBe("adaptive");
    });

    it("should detect claude-sonnet-4-6 as a 4.6 model", async () => {
      const client = new AnthropicCUAClient(
        "anthropic",
        "claude-sonnet-4-6",
        undefined,
        {
          apiKey: "test-key",
          thinkingEffort: "high",
        },
      );
      client.setViewport(1280, 720);

      await client.getAction([{ role: "user", content: "test" }]);

      const callArgs = mockCreate.mock.calls[0][0];
      expect(callArgs.thinking.type).toBe("adaptive");
    });

    it("should handle provider-prefixed model names (anthropic/claude-opus-4-6)", async () => {
      const client = new AnthropicCUAClient(
        "anthropic",
        "anthropic/claude-opus-4-6",
        undefined,
        {
          apiKey: "test-key",
          thinkingEffort: "high",
        },
      );
      client.setViewport(1280, 720);

      await client.getAction([{ role: "user", content: "test" }]);

      const callArgs = mockCreate.mock.calls[0][0];
      expect(callArgs.thinking.type).toBe("adaptive");
    });
  });
});

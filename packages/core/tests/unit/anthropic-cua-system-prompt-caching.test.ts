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

describe("AnthropicCUAClient system prompt caching", () => {
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

  it("should send the system prompt as a content block array with cache_control", async () => {
    const instructions = "You are a helpful browser automation assistant.";
    const client = new AnthropicCUAClient(
      "anthropic",
      "claude-opus-4-6",
      instructions,
      {
        apiKey: "test-key",
      },
    );
    client.setViewport(1280, 720);

    await client.getAction([{ role: "user", content: "test" }]);

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        system: [
          {
            type: "text",
            text: instructions,
            cache_control: { type: "ephemeral" },
          },
        ],
      }),
    );
  });

  it("should not set the system parameter when no instructions are provided", async () => {
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

    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.system).toBeUndefined();
  });
});

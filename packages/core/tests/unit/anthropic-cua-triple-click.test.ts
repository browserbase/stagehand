import { describe, expect, it, vi, beforeEach } from "vitest";
import { AnthropicCUAClient } from "../../lib/v3/agent/AnthropicCUAClient.js";
import Anthropic from "@anthropic-ai/sdk";

vi.mock("@anthropic-ai/sdk", () => {
  const mockCreate = vi.fn();

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

describe("AnthropicCUAClient triple_click handling", () => {
  let mockCreate: ReturnType<typeof vi.fn>;
  let client: AnthropicCUAClient;
  let executedActions: Array<Record<string, unknown>>;

  beforeEach(() => {
    vi.clearAllMocks();
    const anthropic = new Anthropic({ apiKey: "test" });
    mockCreate = anthropic.beta.messages.create as ReturnType<typeof vi.fn>;

    client = new AnthropicCUAClient(
      "anthropic",
      "claude-sonnet-4-5-20250929",
      undefined,
      {
        apiKey: "test-key",
      },
    );
    client.setViewport(1280, 720);
    client.setScreenshotProvider(async () => "fake-base64-screenshot");

    executedActions = [];
    client.setActionHandler(async (action) => {
      executedActions.push({ ...action });
    });
  });

  it("should convert triple_click with coordinate array to tripleClick action", async () => {
    mockCreate.mockResolvedValue({
      id: "test-id",
      content: [
        {
          type: "tool_use",
          id: "tool-1",
          name: "computer",
          input: {
            action: "triple_click",
            coordinate: [640, 360],
          },
        },
      ],
      usage: { input_tokens: 10, output_tokens: 20 },
    });

    const logger = vi.fn();
    await client.executeStep(
      [{ role: "user", content: "triple click the paragraph" }],
      logger,
    );

    expect(executedActions).toHaveLength(1);
    expect(executedActions[0].type).toBe("tripleClick");
    expect(executedActions[0].x).toBe(640);
    expect(executedActions[0].y).toBe(360);
  });

  it("should convert triple_click with x/y fields to tripleClick action", async () => {
    mockCreate.mockResolvedValue({
      id: "test-id",
      content: [
        {
          type: "tool_use",
          id: "tool-2",
          name: "computer",
          input: {
            action: "triple_click",
            x: 100,
            y: 200,
          },
        },
      ],
      usage: { input_tokens: 10, output_tokens: 20 },
    });

    const logger = vi.fn();
    await client.executeStep(
      [{ role: "user", content: "triple click the line" }],
      logger,
    );

    expect(executedActions).toHaveLength(1);
    expect(executedActions[0].type).toBe("tripleClick");
    expect(executedActions[0].x).toBe(100);
    expect(executedActions[0].y).toBe(200);
  });
});

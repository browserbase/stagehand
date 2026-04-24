import { describe, expect, it, vi } from "vitest";
import { AnthropicCUAClient } from "../../lib/v3/agent/AnthropicCUAClient.js";

type AnthropicInputMessage = {
  role: "user" | "assistant";
  content: Array<{
    type: "tool_result";
    tool_use_id: string;
    content:
      | string
      | Array<{
          type: "image";
          source: {
            type: "base64";
            media_type: "image/png";
            data: string;
          };
        }>;
  }>;
};

const logger = vi.fn();

function makeImageMessage(id: string): AnthropicInputMessage {
  return {
    role: "user",
    content: [
      {
        type: "tool_result",
        tool_use_id: id,
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/png",
              data: `${id}-image-data`,
            },
          },
        ],
      },
    ],
  };
}

function isCompressed(message: AnthropicInputMessage): boolean {
  return message.content.some(
    (contentItem) => contentItem.content === "screenshot taken",
  );
}

describe("AnthropicCUAClient maxImages", () => {
  it("keeps two most recent screenshot items by default", async () => {
    const client = new AnthropicCUAClient(
      "anthropic",
      "anthropic/claude-sonnet-4-6",
      undefined,
      { apiKey: "test-key" },
    );

    vi.spyOn(client, "getAction").mockResolvedValue({
      content: [{ type: "text", text: "done" }] as never,
      usage: { input_tokens: 1, output_tokens: 1, inference_time_ms: 1 },
    });

    const inputItems = [
      makeImageMessage("oldest"),
      makeImageMessage("middle"),
      makeImageMessage("newest"),
    ] as never;

    const result = await client.executeStep(inputItems, logger);
    const updated = result.nextInputItems.slice(
      0,
      3,
    ) as AnthropicInputMessage[];

    expect(isCompressed(updated[0])).toBe(true);
    expect(isCompressed(updated[1])).toBe(false);
    expect(isCompressed(updated[2])).toBe(false);
  });

  it("keeps only one recent screenshot item when maxImages is set to 1", async () => {
    const client = new AnthropicCUAClient(
      "anthropic",
      "anthropic/claude-sonnet-4-6",
      undefined,
      { apiKey: "test-key", maxImages: 1 },
    );

    vi.spyOn(client, "getAction").mockResolvedValue({
      content: [{ type: "text", text: "done" }] as never,
      usage: { input_tokens: 1, output_tokens: 1, inference_time_ms: 1 },
    });

    const inputItems = [
      makeImageMessage("oldest"),
      makeImageMessage("middle"),
      makeImageMessage("newest"),
    ] as never;

    const result = await client.executeStep(inputItems, logger);
    const updated = result.nextInputItems.slice(
      0,
      3,
    ) as AnthropicInputMessage[];

    expect(isCompressed(updated[0])).toBe(true);
    expect(isCompressed(updated[1])).toBe(true);
    expect(isCompressed(updated[2])).toBe(false);
  });

  it("disables screenshot compression when maxImages is 0", async () => {
    const client = new AnthropicCUAClient(
      "anthropic",
      "anthropic/claude-sonnet-4-6",
      undefined,
      { apiKey: "test-key", maxImages: 0 },
    );

    vi.spyOn(client, "getAction").mockResolvedValue({
      content: [{ type: "text", text: "done" }] as never,
      usage: { input_tokens: 1, output_tokens: 1, inference_time_ms: 1 },
    });

    const inputItems = [
      makeImageMessage("oldest"),
      makeImageMessage("middle"),
      makeImageMessage("newest"),
    ] as never;

    const result = await client.executeStep(inputItems, logger);
    const updated = result.nextInputItems.slice(
      0,
      3,
    ) as AnthropicInputMessage[];

    expect(isCompressed(updated[0])).toBe(false);
    expect(isCompressed(updated[1])).toBe(false);
    expect(isCompressed(updated[2])).toBe(false);
  });
});

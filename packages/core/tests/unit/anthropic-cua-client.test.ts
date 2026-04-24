import { describe, expect, it, vi } from "vitest";
import { AnthropicCUAClient } from "../../lib/v3/agent/AnthropicCUAClient.js";
import type { ToolUseItem } from "../../lib/v3/types/public/agent.js";

function createClient() {
  return new AnthropicCUAClient(
    "anthropic",
    "anthropic/claude-sonnet-4-6",
    undefined,
    { apiKey: "test-key" },
  );
}

const noopLogger = vi.fn();

function computerToolUseItem(id: string): ToolUseItem {
  return {
    type: "tool_use",
    id,
    name: "computer",
    input: {
      action: "left_click",
    },
  };
}

function extractImageSource(result: {
  content: string | Array<{ type: string; source?: Record<string, unknown> }>;
}): { media_type: string; data: string } {
  const content = result.content;
  if (!Array.isArray(content)) {
    throw new Error("Expected tool_result content array");
  }

  const imageBlock = content.find(
    (block) => block.type === "image" && block.source,
  );
  if (!imageBlock?.source) {
    throw new Error("Expected image block in tool_result content");
  }

  return imageBlock.source as { media_type: string; data: string };
}

describe("AnthropicCUAClient", () => {
  it("uses the screenshot MIME type for computer tool_result images", async () => {
    const client = createClient();
    vi.spyOn(client, "captureScreenshot").mockResolvedValueOnce(
      "data:image/jpeg;base64,abcd1234",
    );

    const results = await client.takeAction(
      [computerToolUseItem("tool-1")],
      noopLogger,
    );

    expect(results).toHaveLength(1);
    const imageSource = extractImageSource(results[0]!);
    expect(imageSource.media_type).toBe("image/jpeg");
    expect(imageSource.data).toBe("abcd1234");
  });

  it("falls back to PNG metadata when screenshot is not an image data URL", async () => {
    const client = createClient();
    vi.spyOn(client, "captureScreenshot").mockResolvedValueOnce(
      "raw-base64-payload",
    );

    const results = await client.takeAction(
      [computerToolUseItem("tool-2")],
      noopLogger,
    );

    const imageSource = extractImageSource(results[0]!);
    expect(imageSource.media_type).toBe("image/png");
    expect(imageSource.data).toBe("raw-base64-payload");
  });

  it("uses parsed MIME/data in error tool_result screenshot payloads", async () => {
    const client = createClient();
    const captureScreenshotSpy = vi
      .spyOn(client, "captureScreenshot")
      .mockRejectedValueOnce(new Error("capture failed"))
      .mockResolvedValueOnce("data:image/webp;base64,errorimg");

    const results = await client.takeAction(
      [computerToolUseItem("tool-3")],
      noopLogger,
    );

    expect(captureScreenshotSpy).toHaveBeenCalledTimes(2);
    const imageSource = extractImageSource(results[0]!);
    expect(imageSource.media_type).toBe("image/webp");
    expect(imageSource.data).toBe("errorimg");
    expect(results[0]?.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "text",
          text: expect.stringContaining("Error: capture failed"),
        }),
      ]),
    );
  });
});

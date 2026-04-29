import { describe, expect, it } from "vitest";
import type { ModelMessage } from "ai";
import { processMessages } from "../../lib/v3/agent/utils/messageProcessing.js";

function visionToolMessage(toolName: string, text: string): ModelMessage {
  return {
    role: "tool",
    content: [
      {
        toolName,
        output: {
          type: "content",
          value: [
            { type: "text", text },
            {
              type: "media",
              mediaType: "image/png",
              data: "base64-image-data",
            },
          ],
        },
      },
    ],
  } as unknown as ModelMessage;
}

describe("processMessages", () => {
  it("treats clickAndHold as a vision action tool for screenshot compression", () => {
    const messages: ModelMessage[] = [
      visionToolMessage("clickAndHold", '{"success":true,"describe":"hold"}'),
      visionToolMessage("click", '{"success":true,"describe":"click"}'),
      visionToolMessage("wait", '{"success":true,"waited":200}'),
    ];

    const compressedCount = processMessages(messages);

    expect(compressedCount).toBe(1);

    const oldestOutput = (
      messages[0] as unknown as {
        content: Array<{
          output: { value: Array<{ type: string; text?: string }> };
        }>;
      }
    ).content[0].output.value;

    expect(oldestOutput).toEqual([
      { type: "text", text: '{"success":true,"describe":"hold"}' },
    ]);
  });
});

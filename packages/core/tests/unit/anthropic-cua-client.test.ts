import { describe, expect, it, vi } from "vitest";
import { AnthropicCUAClient } from "../../lib/v3/agent/AnthropicCUAClient.js";

function createClient() {
  return new AnthropicCUAClient(
    "anthropic",
    "claude-sonnet-4-5-20250929",
    undefined,
    { apiKey: "test-key" },
  );
}

describe("AnthropicCUAClient", () => {
  it("returns a success result when a custom tool completes with undefined", async () => {
    const client = createClient();
    const toolExecute = vi.fn(async () => undefined);

    (
      client as unknown as {
        tools: Record<
          string,
          {
            execute: typeof toolExecute;
          }
        >;
      }
    ).tools = {
      fillUsername: {
        execute: toolExecute,
      },
    };

    const result = await (
      client as unknown as {
        takeAction: (
          output: unknown[],
          logger: (msg: unknown) => void,
        ) => Promise<unknown[]>;
      }
    ).takeAction(
      [
        {
          id: "tool-1",
          name: "fillUsername",
          input: {},
        },
      ],
      vi.fn(),
    );

    expect(toolExecute).toHaveBeenCalledTimes(1);
    expect(result).toEqual([
      {
        type: "tool_result",
        tool_use_id: "tool-1",
        content: [
          {
            type: "text",
            text: "Tool executed successfully",
          },
        ],
      },
    ]);
  });
});

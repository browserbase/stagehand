import { describe, expect, it, vi } from "vitest";
import { YutoriCUAClient } from "../../lib/v3/agent/YutoriCUAClient.js";
import type { AgentAction } from "../../lib/v3/types/public/agent.js";
import type { ClientOptions } from "../../lib/v3/types/public/model.js";

type CreateFn = (...args: unknown[]) => unknown;

function createClient(
  clientOptions: Partial<ClientOptions> = {},
  modelName = "n1.5-latest",
) {
  const client = new YutoriCUAClient("yutori", modelName, undefined, {
    apiKey: "test-key",
    baseURL: "https://example.com",
    ...clientOptions,
  });
  client.setScreenshotProvider(async () => "mock-base64-screenshot");
  client.setViewport(1280, 800);
  client.setCurrentUrl("https://example.com/page");
  return client;
}

function mockCreate(client: YutoriCUAClient, create: CreateFn) {
  (
    client as unknown as {
      client: {
        chat: { completions: { create: CreateFn } };
      };
    }
  ).client = { chat: { completions: { create } } };
}

function assistant(content: string, toolCalls?: unknown[]) {
  return {
    choices: [
      { message: { role: "assistant", content, tool_calls: toolCalls } },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  };
}

function toolCall(name: string, args: Record<string, unknown>, id = "call_1") {
  return {
    id,
    type: "function",
    function: { name, arguments: JSON.stringify(args) },
  };
}

const logger = vi.fn();

describe("YutoriCUAClient", () => {
  it("converts a left_click tool call to a denormalized click action and completes when no tool calls", async () => {
    const client = createClient();
    const actions: AgentAction[] = [];
    client.setActionHandler(async (a) => {
      actions.push(a);
    });

    const create = vi
      .fn()
      // Step 1: model asks for a click in the 1000x1000 space.
      .mockResolvedValueOnce(
        assistant("I will click the button.", [
          toolCall("left_click", { coordinates: [500, 500] }),
        ]),
      )
      // Step 2: no tool calls -> done.
      .mockResolvedValueOnce(assistant("Done. The team has 3 members."));
    mockCreate(client, create);

    const result = await client.execute({
      options: { instruction: "Click the button", maxSteps: 10 },
      logger,
    });

    expect(result.completed).toBe(true);
    expect(result.success).toBe(true);
    expect(result.message).toBe("Done. The team has 3 members.");
    expect(create).toHaveBeenCalledTimes(2);

    // 500/1000 * 1280 = 640 ; 500/1000 * 800 = 400
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      type: "click",
      x: 640,
      y: 400,
      button: "left",
      clickCount: 1,
      // Navigator n1.5 returns reasoning as the assistant message content;
      // it should be threaded onto the action for trajectory/replay.
      reasoning: "I will click the button.",
    });

    // The second request must include the tool result for call_1 with a URL suffix.
    const secondCallMessages = (
      create.mock.calls[1][0] as { messages: unknown[] }
    ).messages as Array<{
      role: string;
      tool_call_id?: string;
      content: unknown;
    }>;
    const toolMsg = secondCallMessages.find((m) => m.role === "tool");
    expect(toolMsg?.tool_call_id).toBe("call_1");
    expect(JSON.stringify(toolMsg?.content)).toContain(
      "Current URL: https://example.com/page",
    );
  });

  it("maps Navigator action variants (double_click, type, key_press, scroll, goto_url, refresh)", async () => {
    const cases: Array<{
      tool: ReturnType<typeof toolCall>;
      expected: Partial<AgentAction>;
    }> = [
      {
        tool: toolCall("double_click", {
          coordinates: [0, 0],
          modifier: "ctrl",
        }),
        expected: {
          type: "click",
          x: 0,
          y: 0,
          clickCount: 2,
          button: "left",
          modifier: "ctrl",
        },
      },
      {
        tool: toolCall("type", { text: "hello" }),
        expected: { type: "type", text: "hello" },
      },
      {
        tool: toolCall("key_press", { key: "ctrl+a" }),
        expected: { type: "keypress", keys: ["Control+a"] },
      },
      {
        tool: toolCall("hold_key", { key: "shift", duration: 0.25 }),
        expected: { type: "keypress", keys: ["Shift"], holdMs: 250 },
      },
      {
        tool: toolCall("scroll", {
          coordinates: [500, 500],
          direction: "down",
          amount: 3,
          modifier: "shift",
        }),
        expected: {
          type: "scroll",
          x: 640,
          y: 400,
          scroll_x: 0,
          scroll_y: 300,
          modifier: "shift",
        },
      },
      {
        tool: toolCall("goto_url", { url: "example.org" }),
        expected: { type: "goto", url: "https://example.org" },
      },
      {
        tool: toolCall("refresh", {}),
        expected: { type: "refresh" },
      },
    ];

    for (const { tool, expected } of cases) {
      const client = createClient();
      const actions: AgentAction[] = [];
      client.setActionHandler(async (a) => {
        actions.push(a);
      });
      const create = vi
        .fn()
        .mockResolvedValueOnce(assistant("acting", [tool]))
        .mockResolvedValueOnce(assistant("done"));
      mockCreate(client, create);

      await client.execute({
        options: { instruction: "x", maxSteps: 5 },
        logger,
      });

      expect(actions[0]).toMatchObject(expected);
    }
  });

  it("sends Navigator extra params (tool_set, disable_tools) on the request", async () => {
    const client = createClient();
    client.setActionHandler(async () => {});
    const create = vi.fn().mockResolvedValueOnce(assistant("done"));
    mockCreate(client, create);

    await client.execute({
      options: { instruction: "x", maxSteps: 3 },
      logger,
    });

    const body = create.mock.calls[0][0] as {
      model: string;
      tool_set: string;
      disable_tools?: string[];
    };
    expect(body.model).toBe("n1.5-latest");
    expect(body.tool_set).toBe("browser_tools_core-20260403");
    expect(body.disable_tools).toEqual(["mouse_down", "mouse_up"]);
  });

  it("merges user-disabled Navigator tools with always-unsupported mouse tools", async () => {
    const client = createClient({
      disableTools: ["drag", "mouse_down"],
    });
    client.setActionHandler(async () => {});
    const create = vi.fn().mockResolvedValueOnce(assistant("done"));
    mockCreate(client, create);

    await client.execute({
      options: { instruction: "x", maxSteps: 3 },
      logger,
    });

    expect(
      (create.mock.calls[0][0] as { disable_tools?: string[] }).disable_tools,
    ).toEqual(["mouse_down", "mouse_up", "drag"]);
  });

  it("strips the Stagehand provider prefix before calling the Yutori API", async () => {
    const client = createClient({}, "yutori/n1.5-latest");
    client.setActionHandler(async () => {});
    const create = vi.fn().mockResolvedValueOnce(assistant("done"));
    mockCreate(client, create);

    await client.execute({
      options: { instruction: "x", maxSteps: 3 },
      logger,
    });

    expect((create.mock.calls[0][0] as { model: string }).model).toBe(
      "n1.5-latest",
    );
  });

  it("rejects unsupported Navigator tool sets until expanded tools are implemented", () => {
    expect(
      () =>
        new YutoriCUAClient("yutori", "n1.5-latest", undefined, {
          apiKey: "test-key",
          baseURL: "https://example.com",
          toolSet: "browser_tools_expanded-20260403",
        }),
    ).toThrow("not supported by Stagehand yet");
  });

  it("requests a stop-and-summarize when max steps are exhausted", async () => {
    const jsonSchema = {
      type: "object",
      properties: { status: { type: "string" } },
    };
    const client = createClient({
      disableTools: ["drag"],
      jsonSchema,
    });
    client.setActionHandler(async () => {});

    // Every step returns a tool call (never naturally completes).
    const create = vi
      .fn()
      .mockResolvedValueOnce(
        assistant("still working", [
          toolCall("left_click", { coordinates: [10, 10] }),
        ]),
      )
      // The extra call is the stop-and-summarize turn.
      .mockResolvedValueOnce(
        assistant("Summary: I clicked once before stopping."),
      );
    mockCreate(client, create);

    const result = await client.execute({
      options: { instruction: "Do something long", maxSteps: 1 },
      logger,
    });

    expect(result.completed).toBe(false);
    expect(result.message).toBe("Summary: I clicked once before stopping.");
    // 1 step + 1 summarize call.
    expect(create).toHaveBeenCalledTimes(2);

    // The summarize request includes the stop-and-summarize prompt.
    const lastMessages = (create.mock.calls[1][0] as { messages: unknown[] })
      .messages as Array<{ role: string; content: unknown }>;
    expect(JSON.stringify(lastMessages)).toContain("Stop here.");
    // The step-loop call requests structured output ...
    expect(create.mock.calls[0][0]).toMatchObject({
      tool_set: "browser_tools_core-20260403",
      disable_tools: ["mouse_down", "mouse_up", "drag"],
      json_schema: jsonSchema,
    });
    // ... but the summarize turn asks for a free-text summary, so it must NOT
    // constrain decoding with json_schema (that would corrupt the message).
    expect(create.mock.calls[1][0]).toMatchObject({
      tool_set: "browser_tools_core-20260403",
      disable_tools: ["mouse_down", "mouse_up", "drag"],
    });
    expect(
      (create.mock.calls[1][0] as { json_schema?: unknown }).json_schema,
    ).toBeUndefined();
  });

  it("returns a failed result when the model call throws", async () => {
    const client = createClient();
    client.setActionHandler(async () => {});
    const create = vi.fn().mockRejectedValue(new Error("upstream error"));
    mockCreate(client, create);

    const result = await client.execute({
      options: { instruction: "x", maxSteps: 3 },
      logger,
    });

    expect(result.success).toBe(false);
    expect(result.completed).toBe(false);
    expect(result.message).toContain("upstream error");
  });
});

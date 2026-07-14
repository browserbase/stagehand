import { describe, expect, it, vi } from "vitest";
import { YutoriCUAClient } from "../../lib/v3/agent/YutoriCUAClient.js";
import type { AgentAction } from "../../lib/v3/types/public/agent.js";

type CreateFn = (...args: unknown[]) => unknown;

function createClient() {
  const client = new YutoriCUAClient("yutori", "n1.5-latest", undefined, {
    apiKey: "test-key",
    baseURL: "https://example.com",
  });
  client.setScreenshotProvider(async () => ({
    base64: "mock-base64-screenshot",
    mediaType: "image/png",
  }));
  client.setViewport(1280, 800);
  client.setCurrentUrl("https://example.com/page");
  return client;
}

function mockCreate(client: YutoriCUAClient, create: CreateFn) {
  (
    client as unknown as {
      client: { chat: { completions: { create: CreateFn } } };
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

/** Run a single tool call through one step and return the dispatched action. */
async function runSingleAction(
  tool: ReturnType<typeof toolCall>,
): Promise<AgentAction> {
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
  await client.execute({ options: { instruction: "x", maxSteps: 5 }, logger });
  return actions[0];
}

describe("YutoriCUAClient structured output", () => {
  it("surfaces response.parsed_json on AgentResult.output", async () => {
    const client = createClient();
    client.setActionHandler(async () => {});
    const create = vi.fn().mockResolvedValueOnce({
      ...assistant("done"),
      parsed_json: { status: "ok", count: 3 },
    });
    mockCreate(client, create);

    const result = await client.execute({
      options: { instruction: "x", maxSteps: 3 },
      logger,
    });

    expect(result.output).toEqual({ status: "ok", count: 3 });
  });

  it("omits AgentResult.output when no parsed_json is returned", async () => {
    const client = createClient();
    client.setActionHandler(async () => {});
    const create = vi.fn().mockResolvedValueOnce(assistant("done"));
    mockCreate(client, create);

    const result = await client.execute({
      options: { instruction: "x", maxSteps: 3 },
      logger,
    });

    expect(result.output).toBeUndefined();
  });
});

describe("YutoriCUAClient error recovery (feeds [ERROR] back to the model)", () => {
  it("recovers from malformed tool-call arguments without aborting the run", async () => {
    const client = createClient();
    const actions: AgentAction[] = [];
    client.setActionHandler(async (a) => {
      actions.push(a);
    });

    const badToolCall = {
      id: "call_bad",
      type: "function",
      function: { name: "left_click", arguments: "{not valid json" },
    };
    const create = vi
      .fn()
      .mockResolvedValueOnce(assistant("acting", [badToolCall]))
      .mockResolvedValueOnce(assistant("done"));
    mockCreate(client, create);

    const result = await client.execute({
      options: { instruction: "x", maxSteps: 5 },
      logger,
    });

    // The run completes (the model's next turn has no tool calls).
    expect(result.completed).toBe(true);
    // The unparseable call produced no action ...
    expect(actions).toHaveLength(0);
    // ... and a recoverable [ERROR] tool result was fed back to the model.
    const secondMessages = (create.mock.calls[1][0] as { messages: unknown[] })
      .messages as Array<{ role: string; content: unknown }>;
    expect(JSON.stringify(secondMessages)).toContain(
      "Failed to parse arguments",
    );
  });

  it("recovers when the action handler throws (records the action + [ERROR])", async () => {
    const client = createClient();
    client.setActionHandler(async () => {
      throw new Error("element detached");
    });

    const create = vi
      .fn()
      .mockResolvedValueOnce(
        assistant("clicking", [
          toolCall("left_click", { coordinates: [10, 10] }),
        ]),
      )
      .mockResolvedValueOnce(assistant("done"));
    mockCreate(client, create);

    const result = await client.execute({
      options: { instruction: "x", maxSteps: 5 },
      logger,
    });

    expect(result.completed).toBe(true);
    // The action is still recorded even though the handler threw.
    expect(result.actions.some((a) => a.type === "click")).toBe(true);
    const secondMessages = (create.mock.calls[1][0] as { messages: unknown[] })
      .messages as Array<{ role: string; content: unknown }>;
    expect(JSON.stringify(secondMessages)).toContain("element detached");
  });

  it("invalid (non-finite) coordinates surface a recoverable error, not a NaN click", async () => {
    const client = createClient();
    const actions: AgentAction[] = [];
    client.setActionHandler(async (a) => {
      actions.push(a);
    });
    const create = vi
      .fn()
      .mockResolvedValueOnce(
        assistant("acting", [
          toolCall("left_click", { coordinates: ["x", 5] }),
        ]),
      )
      .mockResolvedValueOnce(assistant("done"));
    mockCreate(client, create);

    const result = await client.execute({
      options: { instruction: "x", maxSteps: 5 },
      logger,
    });

    expect(result.completed).toBe(true);
    expect(actions).toHaveLength(0); // no NaN click dispatched
    const secondMessages = (create.mock.calls[1][0] as { messages: unknown[] })
      .messages as Array<{ role: string }>;
    expect(JSON.stringify(secondMessages)).toContain("[ERROR]");
  });
});

describe("YutoriCUAClient multiple tool calls per turn", () => {
  it("emits a matching role:'tool' result for every tool call", async () => {
    const client = createClient();
    const actions: AgentAction[] = [];
    client.setActionHandler(async (a) => {
      actions.push(a);
    });

    const create = vi
      .fn()
      .mockResolvedValueOnce(
        assistant("two actions", [
          toolCall("left_click", { coordinates: [10, 10] }, "call_a"),
          toolCall("type", { text: "hi" }, "call_b"),
        ]),
      )
      .mockResolvedValueOnce(assistant("done"));
    mockCreate(client, create);

    await client.execute({
      options: { instruction: "x", maxSteps: 5 },
      logger,
    });

    expect(actions).toHaveLength(2);
    const secondMessages = (create.mock.calls[1][0] as { messages: unknown[] })
      .messages as Array<{ role: string; tool_call_id?: string }>;
    const toolIds = secondMessages
      .filter((m) => m.role === "tool")
      .map((m) => m.tool_call_id);
    expect(toolIds).toEqual(["call_a", "call_b"]);
  });
});

describe("YutoriCUAClient action mappings (1280x800 viewport)", () => {
  const cases: Array<{
    name: string;
    tool: ReturnType<typeof toolCall>;
    expected: Partial<AgentAction>;
  }> = [
    {
      name: "triple_click",
      tool: toolCall("triple_click", { coordinates: [0, 0] }),
      expected: { type: "click", x: 0, y: 0, clickCount: 3, button: "left" },
    },
    {
      name: "middle_click",
      tool: toolCall("middle_click", { coordinates: [0, 0] }),
      expected: { type: "click", button: "middle", clickCount: 1 },
    },
    {
      name: "right_click",
      tool: toolCall("right_click", { coordinates: [1000, 1000] }),
      expected: { type: "click", x: 1279, y: 799, button: "right" },
    },
    {
      name: "mouse_move",
      tool: toolCall("mouse_move", { coordinates: [500, 500] }),
      expected: { type: "move", x: 640, y: 400 },
    },
    {
      name: "scroll up",
      tool: toolCall("scroll", {
        coordinates: [500, 500],
        direction: "up",
        amount: 2,
      }),
      expected: { type: "scroll", x: 640, y: 400, scroll_x: 0, scroll_y: -200 },
    },
    {
      name: "scroll left",
      tool: toolCall("scroll", {
        coordinates: [500, 500],
        direction: "left",
        amount: 1,
      }),
      expected: { type: "scroll", scroll_x: -100, scroll_y: 0 },
    },
    {
      name: "scroll right",
      tool: toolCall("scroll", {
        coordinates: [500, 500],
        direction: "right",
        amount: 1,
      }),
      expected: { type: "scroll", scroll_x: 100, scroll_y: 0 },
    },
    {
      name: "goto_url with an explicit scheme is left unchanged",
      tool: toolCall("goto_url", { url: "http://example.org/x" }),
      expected: { type: "goto", url: "http://example.org/x" },
    },
    {
      name: "go_back",
      tool: toolCall("go_back", {}),
      expected: { type: "back" },
    },
    {
      name: "go_forward",
      tool: toolCall("go_forward", {}),
      expected: { type: "forward" },
    },
    {
      name: "wait (defaults to 5s)",
      tool: toolCall("wait", {}),
      expected: { type: "wait", timeMs: 5000 },
    },
    {
      name: "drag",
      tool: toolCall("drag", {
        start_coordinates: [0, 0],
        coordinates: [1000, 1000],
      }),
      expected: {
        type: "drag",
        path: [
          { x: 0, y: 0 },
          { x: 1279, y: 799 },
        ],
      },
    },
  ];

  for (const { name, tool, expected } of cases) {
    it(`maps ${name}`, async () => {
      expect(await runSingleAction(tool)).toMatchObject(expected);
    });
  }

  it("hold_key without a duration maps to a plain keypress (no holdMs)", async () => {
    const action = await runSingleAction(
      toolCall("hold_key", { key: "enter" }),
    );
    expect(action).toMatchObject({ type: "keypress", keys: ["Enter"] });
    expect(action.holdMs).toBeUndefined();
  });

  it("a plain click carries no modifier field", async () => {
    const action = await runSingleAction(
      toolCall("left_click", { coordinates: [10, 10] }),
    );
    expect(action.type).toBe("click");
    expect(action.modifier).toBeUndefined();
  });
});

describe("YutoriCUAClient tool-result URL suffix", () => {
  it("reflects the current URL at the time of the step, not a stale one", async () => {
    const client = createClient();
    client.setCurrentUrl("https://a.com");
    client.setActionHandler(async () => {});

    const create = vi
      .fn()
      // The model acts on step 1; meanwhile the page navigates and the handler
      // refreshes the client URL (simulated here before the response resolves).
      .mockImplementationOnce(async () => {
        client.setCurrentUrl("https://b.com");
        return assistant("acting", [
          toolCall("left_click", { coordinates: [10, 10] }),
        ]);
      })
      .mockResolvedValueOnce(assistant("done"));
    mockCreate(client, create);

    await client.execute({
      options: { instruction: "x", maxSteps: 5 },
      logger,
    });

    const secondMessages = (create.mock.calls[1][0] as { messages: unknown[] })
      .messages as Array<{ role: string; content: unknown }>;
    const toolMsg = secondMessages.find((m) => m.role === "tool");
    const serialized = JSON.stringify(toolMsg?.content);
    expect(serialized).toContain("Current URL: https://b.com");
    expect(serialized).not.toContain("https://a.com");
  });
});

describe("YutoriCUAClient stop-and-summarize failure", () => {
  it("returns a deterministic message (not empty) when the summary call fails", async () => {
    const client = createClient();
    client.setActionHandler(async () => {});

    const create = vi
      .fn()
      // Step 1 keeps working (a tool call), so the run hits max steps ...
      .mockResolvedValueOnce(
        assistant("working", [
          toolCall("left_click", { coordinates: [10, 10] }),
        ]),
      )
      // ... and the stop-and-summarize call then fails.
      .mockRejectedValueOnce(new Error("summary upstream 500"));
    mockCreate(client, create);

    const result = await client.execute({
      options: { instruction: "do something", maxSteps: 1 },
      logger,
    });

    expect(result.completed).toBe(false);
    expect(result.message).toContain("could not generate a summary");
    expect(result.actions.some((a) => a.type === "click")).toBe(true);
  });
});

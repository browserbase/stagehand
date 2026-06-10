import { describe, expect, it, vi } from "vitest";
import { YutoriCUAClient } from "../../lib/v3/agent/YutoriCUAClient.js";
import type { AgentAction } from "../../lib/v3/types/public/agent.js";

type CreateFn = (...args: unknown[]) => unknown;

const SNAPSHOT = {
  combinedTree: ["[0-1] textbox: Email", "[0-2] button: Submit"].join("\n"),
  combinedXpathMap: {
    "0-1": "/html/body/input[1]",
    "0-2": "/html/body/button[1]",
  },
  combinedUrlMap: {},
};

function createClient(
  create: CreateFn,
  bridge: {
    snapshot?: () => Promise<typeof SNAPSHOT>;
    evaluate?: (s: string) => Promise<unknown>;
    elementCenter?: (xpath: string) => Promise<{ x: number; y: number } | null>;
  },
) {
  const client = new YutoriCUAClient("yutori", "n1.5-latest", undefined, {
    apiKey: "test-key",
    baseURL: "https://example.com",
    toolSet: "browser_tools_expanded-20260403",
  });
  client.setScreenshotProvider(async () => "mock-shot");
  client.setViewport(1280, 800);
  client.setCurrentUrl("https://example.com/page");
  client.setPageBridge({
    snapshot: bridge.snapshot ?? (async () => SNAPSHOT),
    evaluate: bridge.evaluate ?? (async () => null),
    elementCenter: bridge.elementCenter ?? (async () => null),
  });
  (
    client as unknown as {
      client: { chat: { completions: { create: CreateFn } } };
    }
  ).client = { chat: { completions: { create } } };
  return client;
}

function assistant(content: string, toolCalls?: unknown[]) {
  return {
    choices: [
      { message: { role: "assistant", content, tool_calls: toolCalls } },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  };
}
function toolCall(name: string, args: Record<string, unknown>, id = "c1") {
  return {
    id,
    type: "function",
    function: { name, arguments: JSON.stringify(args) },
  };
}
function toolMessages(create: ReturnType<typeof vi.fn>) {
  // Collect the raw text of every tool-result message across all requests.
  const seen = new Set<string>();
  for (const call of create.mock.calls) {
    const msgs = (call[0] as { messages: unknown[] }).messages as Array<{
      role: string;
      content: unknown;
    }>;
    for (const m of msgs) {
      if (m.role !== "tool" || !Array.isArray(m.content)) continue;
      for (const part of m.content as Array<{ type: string; text?: string }>) {
        if (part.type === "text" && part.text) seen.add(part.text);
      }
    }
  }
  return [...seen].join("\n");
}

const logger = vi.fn();

describe("YutoriCUAClient — expanded tool set", () => {
  it("extract_elements renders the a11y tree with refs, and set_element_value fills by ref", async () => {
    const actions: AgentAction[] = [];
    const create = vi
      .fn()
      .mockResolvedValueOnce(
        assistant("reading page", [toolCall("extract_elements", {})]),
      )
      .mockResolvedValueOnce(
        assistant("filling email", [
          toolCall("set_element_value", { ref: "ref_1", value: "a@b.com" }),
        ]),
      )
      .mockResolvedValueOnce(assistant("done"));
    const client = createClient(create, {});
    client.setActionHandler(async (a) => {
      actions.push(a);
    });

    const result = await client.execute({
      options: { instruction: "fill the email", maxSteps: 5 },
      logger,
    });

    expect(result.completed).toBe(true);
    // extract_elements result rendered in Navigator format with a ref.
    expect(toolMessages(create)).toContain('- textbox "Email" [ref=ref_1]');
    // set_element_value resolved ref_1 -> its xpath and dispatched a fill.
    expect(actions).toEqual([
      expect.objectContaining({
        type: "set_value",
        selector: "/html/body/input[1]",
        text: "a@b.com",
      }),
    ]);
    expect(toolMessages(create)).toContain('Set ref_1 to "a@b.com"');
  });

  it("find returns matching refs and execute_js returns the evaluated result", async () => {
    const evaluate = vi.fn(async () => "Example Domain");
    const create = vi
      .fn()
      .mockResolvedValueOnce(
        assistant("searching", [toolCall("find", { text: "Submit" })]),
      )
      .mockResolvedValueOnce(
        assistant("reading title", [
          toolCall("execute_js", { text: "document.title" }),
        ]),
      )
      .mockResolvedValueOnce(assistant("done"));
    const client = createClient(create, { evaluate });
    client.setActionHandler(async () => {});

    await client.execute({
      options: { instruction: "x", maxSteps: 5 },
      logger,
    });

    const msgs = toolMessages(create);
    expect(msgs).toContain('Found 1 element(s) matching "Submit"');
    expect(msgs).toContain('button "Submit" [ref=');
    expect(evaluate).toHaveBeenCalled();
    expect(msgs).toContain('"Example Domain"');
  });

  it("resolves a ref on a coordinate tool to the element center, preferring it over model coordinates", async () => {
    const actions: AgentAction[] = [];
    const elementCenter = vi.fn(async (xpath: string) =>
      xpath === "/html/body/button[1]" ? { x: 321, y: 654 } : null,
    );
    const create = vi
      .fn()
      // Mint refs (ref_1 = textbox, ref_2 = button) from the a11y tree.
      .mockResolvedValueOnce(
        assistant("reading", [toolCall("extract_elements", {})]),
      )
      // Click by ref, with bogus model coordinates that must be ignored.
      .mockResolvedValueOnce(
        assistant("clicking submit", [
          toolCall("left_click", { ref: "ref_2", coordinates: [0, 0] }),
        ]),
      )
      .mockResolvedValueOnce(assistant("done"));
    const client = createClient(create, { elementCenter });
    client.setActionHandler(async (a) => {
      actions.push(a);
    });

    await client.execute({
      options: { instruction: "click submit", maxSteps: 5 },
      logger,
    });

    expect(elementCenter).toHaveBeenCalledWith("/html/body/button[1]");
    // The ref-resolved center wins over the model's [0,0] coordinates, and is
    // used as-is (already viewport pixels — not denormalized).
    expect(actions).toEqual([
      expect.objectContaining({
        type: "click",
        x: 321,
        y: 654,
        button: "left",
        clickCount: 1,
      }),
    ]);
  });

  it("treats a ref'd scroll as scroll-into-view, ignoring direction/amount (no overshoot)", async () => {
    const actions: AgentAction[] = [];
    // elementCenter scrolls the element into view and returns its center; the
    // scroll action must not then apply an additional directional delta.
    const elementCenter = vi.fn(async () => ({ x: 200, y: 300 }));
    const create = vi
      .fn()
      .mockResolvedValueOnce(
        assistant("reading", [toolCall("extract_elements", {})]),
      )
      .mockResolvedValueOnce(
        assistant("scrolling to it", [
          toolCall("scroll", {
            ref: "ref_2",
            coordinates: [],
            direction: "down",
            amount: 5,
          }),
        ]),
      )
      .mockResolvedValueOnce(assistant("done"));
    const client = createClient(create, { elementCenter });
    client.setActionHandler(async (a) => {
      actions.push(a);
    });

    await client.execute({
      options: { instruction: "scroll to submit", maxSteps: 5 },
      logger,
    });

    expect(elementCenter).toHaveBeenCalledWith("/html/body/button[1]");
    // No directional delta despite direction:"down", amount:5.
    expect(actions).toEqual([
      expect.objectContaining({
        type: "scroll",
        x: 200,
        y: 300,
        scroll_x: 0,
        scroll_y: 0,
      }),
    ]);
  });

  it("errors (without acting) when a coordinate tool's ref is stale and no coordinates are given", async () => {
    const actions: AgentAction[] = [];
    const create = vi
      .fn()
      .mockResolvedValueOnce(
        assistant("clicking", [toolCall("left_click", { ref: "ref_404" })]),
      )
      .mockResolvedValueOnce(assistant("done"));
    const client = createClient(create, {
      elementCenter: async () => ({ x: 1, y: 2 }),
    });
    client.setActionHandler(async (a) => {
      actions.push(a);
    });

    await client.execute({
      options: { instruction: "x", maxSteps: 5 },
      logger,
    });

    expect(actions).toEqual([]);
    expect(toolMessages(create)).toContain('stale ref "ref_404"');
  });

  it("falls back to model coordinates when a ref cannot be resolved on-screen", async () => {
    const actions: AgentAction[] = [];
    const create = vi
      .fn()
      .mockResolvedValueOnce(
        assistant("reading", [toolCall("extract_elements", {})]),
      )
      // ref_2 is known but elementCenter returns null (off-screen/detached);
      // the model also supplied coordinates, so we fall back to them.
      .mockResolvedValueOnce(
        assistant("clicking", [
          toolCall("left_click", { ref: "ref_2", coordinates: [500, 500] }),
        ]),
      )
      .mockResolvedValueOnce(assistant("done"));
    const client = createClient(create, {
      elementCenter: async () => null,
    });
    client.setActionHandler(async (a) => {
      actions.push(a);
    });

    await client.execute({
      options: { instruction: "x", maxSteps: 5 },
      logger,
    });

    // 500/1000 * 1280 = 640 ; 500/1000 * 800 = 400 (model coords, denormalized).
    expect(actions).toEqual([
      expect.objectContaining({ type: "click", x: 640, y: 400 }),
    ]);
  });

  it("sends the expanded tool_set on the request", async () => {
    const create = vi.fn().mockResolvedValueOnce(assistant("done"));
    const client = createClient(create, {});
    client.setActionHandler(async () => {});
    await client.execute({
      options: { instruction: "x", maxSteps: 2 },
      logger,
    });
    const body = create.mock.calls[0][0] as { tool_set: string };
    expect(body.tool_set).toBe("browser_tools_expanded-20260403");
  });

  it("returns a recoverable error for an unknown/stale ref", async () => {
    const actions: AgentAction[] = [];
    const create = vi
      .fn()
      .mockResolvedValueOnce(
        assistant("filling", [
          toolCall("set_element_value", { ref: "ref_999", value: "x" }),
        ]),
      )
      .mockResolvedValueOnce(assistant("done"));
    const client = createClient(create, {});
    client.setActionHandler(async (a) => {
      actions.push(a);
    });

    await client.execute({
      options: { instruction: "x", maxSteps: 5 },
      logger,
    });
    expect(actions).toEqual([]); // no action dispatched for a bad ref
    expect(toolMessages(create)).toContain("stale ref");
  });
});

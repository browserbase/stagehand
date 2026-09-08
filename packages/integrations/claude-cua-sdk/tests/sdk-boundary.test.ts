import { BrowserContext } from "@browserbasehq/stagehand";
import { describe, expect, it } from "vitest";
import { StagehandCuaExecutor, type CuaFacadeTools } from "../src/index.js";

const logger = { log: () => {}, warn: () => {}, error: () => {} };

function sdkFacade() {
  const calls: Array<{ method: string; params: unknown }> = [];
  let activeId = "p1";
  const context = new BrowserContext({
    send: async (method, params) => {
      const parsed = method.params.parse(params);
      calls.push({ method: method.name, params: parsed });
      switch (method.name) {
        case "context.pages":
          return [{ pageId: "p1" }, { pageId: "p2" }] as never;
        case "context.active_page":
          return { pageId: activeId } as never;
        case "context.set_active_page":
          activeId = (parsed as { pageId: string }).pageId;
          return { ok: true } as never;
        case "page.url":
          return `https://example.com/${(parsed as { pageId: string }).pageId}` as never;
        case "page.title":
          return "Example" as never;
        case "page.click":
        case "page.drag_and_drop":
          return { ok: true } as never;
        default:
          throw new Error(`unexpected RPC ${method.name}`);
      }
    },
    onNotification: () => () => {},
  });
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const tools: CuaFacadeTools = {
    run: async (code) =>
      new AsyncFunction("batchStagehand", code)({ page: await context.activePage(), context }),
    runActions: async () => {
      throw new Error("unexpected ref action");
    },
    snapshot: async () => {
      throw new Error("unexpected snapshot");
    },
    screenshot: async () => {
      throw new Error("unexpected screenshot");
    },
  };
  return { calls, executor: new StagehandCuaExecutor({ tools, logger }) };
}

describe("CUA SDK Page boundary", () => {
  it("executes the complete drag through the real SDK Page and validates its RPC input", async () => {
    const { calls, executor } = sdkFacade();
    const result = await executor.execute(
      "left_click_drag",
      {
        from: { type: "coordinate", x: 10, y: 20 },
        target: { type: "coordinate", x: 90, y: 80 },
      },
      { toolUseId: "drag" },
    );

    expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
    expect(calls.filter((call) => call.method === "page.drag_and_drop")).toEqual([
      {
        method: "page.drag_and_drop",
        params: { pageId: "p1", fromX: 10, fromY: 20, toX: 90, toY: 80, options: { steps: 2 } },
      },
    ]);
  });
  it("honors tab_id before a coordinate action instead of clicking the active tab", async () => {
    const { calls, executor } = sdkFacade();
    const result = await executor.execute(
      "left_click",
      {
        tab_id: "p2",
        target: { type: "coordinate", x: 10, y: 20 },
      },
      { toolUseId: "target-tab" },
    );
    expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
    expect(calls.filter((call) => call.method === "page.click")).toEqual([
      {
        method: "page.click",
        params: { pageId: "p2", x: 10, y: 20, options: { button: "left", clickCount: 1 } },
      },
    ]);
    expect(result.content).toContainEqual(
      expect.objectContaining({
        type: "browser_state",
        tabs: [
          expect.objectContaining({ tab_id: "p1", active: false }),
          expect.objectContaining({ tab_id: "p2", active: true }),
        ],
      }),
    );
  });

  it("rejects an unknown tab before executing an action", async () => {
    const { calls, executor } = sdkFacade();
    const result = await executor.execute(
      "left_click",
      {
        tab_id: "missing",
        target: { type: "coordinate", x: 10, y: 20 },
      },
      { toolUseId: "missing-tab" },
    );
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Unknown tab_id "missing"');
    expect(calls.some((call) => call.method === "page.click")).toBe(false);
  });

  it("rejects unsupported modifier clicks before forwarding invalid SDK options", async () => {
    const { calls, executor } = sdkFacade();
    const result = await executor.execute(
      "left_click",
      {
        target: { type: "coordinate", x: 10, y: 20 },
        modifiers: "shift",
      },
      { toolUseId: "modifier-click" },
    );
    expect(result.isError).toBe(true);
    expect(result.content).toContain("modifier clicks are not available");
    expect(calls).toEqual([]);
  });
});

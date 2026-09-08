import { Page } from "@browserbasehq/stagehand";
import { describe, expect, it } from "vitest";
import { StagehandCuaExecutor, type CuaFacadeTools } from "../src/index.js";

const logger = { log: () => {}, warn: () => {}, error: () => {} };

describe("CUA SDK Page boundary", () => {
  it("executes the complete drag through the real SDK Page and validates its RPC input", async () => {
    const calls: Array<{ method: string; params: unknown }> = [];
    const page = new Page(
      {
        send: async (method, params) => {
          calls.push({ method: method.name, params: method.params.parse(params) });
          return "https://example.com/" as never;
        },
        onNotification: () => () => {},
      },
      { pageId: "p1" },
    );
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const tools: CuaFacadeTools = {
      run: async (code) =>
        new AsyncFunction("batchStagehand", code)({
          page,
          context: { pages: async () => [page] },
        }),
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
    const executor = new StagehandCuaExecutor({ tools, logger });
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
});

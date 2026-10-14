import { Page } from "@browserbasehq/stagehand";
import { describe, expect, it } from "vitest";
import { GeminiCuaExecutor } from "../src/executor.js";

const logger = { log() {}, warn() {}, error() {} };

function sdkFacade() {
  const calls: Array<{ method: string; params: unknown }> = [];
  const page = new Page(
    {
      send: async (method, params) => {
        calls.push({ method: method.name, params: method.params.parse(params) });
        return { ok: true } as never;
      },
      onNotification: () => () => {},
    },
    { pageId: "p1" },
  );
  const waits: number[] = [];
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const executor = new GeminiCuaExecutor(
    {
      run: async (code) =>
        new AsyncFunction("batchStagehand", "page", code)(
          { page },
          {
            waitForTimeout: async (ms: number) => {
              waits.push(ms);
            },
          },
        ),
      screenshot: async () => {
        throw new Error("unexpected screenshot");
      },
    },
    logger,
  );
  return { executor, calls, waits };
}

describe("Gemini CUA SDK Page boundary", () => {
  it.each([
    { x: 0, y: 0, destination_x: 999, destination_y: 999 },
    { start_x: 0, start_y: 0, end_x: 999, end_y: 999 },
  ])("executes normalized drags through the actual SDK Page (%j)", async (input) => {
    const { executor, calls } = sdkFacade();
    const result = await executor.execute("drag_and_drop", input);
    expect(result.isError, result.text).not.toBe(true);
    expect(calls).toEqual([
      {
        method: "page.drag_and_drop",
        params: { pageId: "p1", fromX: 0, fromY: 0, toX: 1286, toY: 710, options: { steps: 2 } },
      },
    ]);
  });
  it("executes a hotkey array as one native key chord", async () => {
    const { executor, calls } = sdkFacade();
    const result = await executor.execute("hotkey", { keys: ["Control", "a"] });
    expect(result.isError, result.text).not.toBe(true);
    expect(calls).toEqual([
      { method: "page.key_press", params: { pageId: "p1", key: "Control+a" } },
    ]);
  });

  it.each([
    ["wait", {}, 1000],
    ["wait", { seconds: 2.5 }, 2500],
    ["wait", { seconds: 0 }, 0],
    ["wait_5_seconds", {}, 5000],
  ])("honors %s duration %j", async (name, input, ms) => {
    const { executor, waits } = sdkFacade();
    const result = await executor.execute(name, input);
    expect(result.isError, result.text).not.toBe(true);
    expect(waits).toEqual([ms]);
  });

  it.each([
    ["scroll", {}, 300],
    ["scroll_at", {}, 800],
    ["scroll", { magnitude_in_pixels: 125 }, 125],
    ["scroll_at", { magnitude: 90 }, 90],
  ])("preserves the %s scroll amount %j", async (name, magnitude, amount) => {
    const { executor, calls } = sdkFacade();
    const result = await executor.execute(name, {
      x: 500,
      y: 500,
      direction: "down",
      ...magnitude,
    });
    expect(result.isError, result.text).not.toBe(true);
    expect(calls).toEqual([
      {
        method: "page.scroll",
        params: { pageId: "p1", x: 644, y: 355, deltaX: 0, deltaY: amount },
      },
    ]);
  });

  it.each([
    ["hotkey", { keys: [] }],
    ["wait", { seconds: -1 }],
    ["wait", { seconds: "2" }],
    ["wait", { seconds: Number.POSITIVE_INFINITY }],
  ])("rejects invalid %s input before execution", async (name, input) => {
    const { executor, calls, waits } = sdkFacade();
    expect((await executor.execute(name, input)).isError).toBe(true);
    expect(calls).toEqual([]);
    expect(waits).toEqual([]);
  });
});

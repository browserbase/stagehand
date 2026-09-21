import { StagehandFacadeSessionLostError } from "@browserbasehq/stagehand-integrations/facade";
import { describe, expect, it, vi } from "vitest";
import { GeminiCuaExecutor } from "../src/executor.js";
const logger = { log: () => {}, warn: () => {}, error: () => {} };
describe("GeminiCuaExecutor", () => {
  it("denormalizes coordinates and expands type_text_at", async () => {
    const calls: string[] = [];
    const executor = new GeminiCuaExecutor(
      {
        run: async (code) => {
          calls.push(code);
        },
        screenshot: async () => ({ data: "", mimeType: "image/png" }),
      },
      logger,
    );
    await executor.execute("type_text_at", { x: 500, y: 500, text: "hello", press_enter: true });
    expect(calls[0]).toContain("page.click(644, 355");
    expect(calls[0]).toContain('page.keyPress("Control+a")');
    expect(calls[0]).toContain('page.keyPress("Backspace")');
    expect(calls[0]).toContain('page.keyPress("Enter")');
  });

  it.each([
    [0, 0, 0, 0],
    [999, 999, 1286, 710],
    [-10, 2000, 0, 710],
  ])("clamps normalized coordinates (%s, %s)", async (inputX, inputY, outputX, outputY) => {
    const calls: string[] = [];
    const executor = new GeminiCuaExecutor(
      {
        run: async (code) => calls.push(code),
        screenshot: async () => ({ data: "", mimeType: "image/png" }),
      },
      logger,
    );
    await executor.execute("click_at", { x: inputX, y: inputY });
    expect(calls[0]).toContain(`page.click(${outputX}, ${outputY}`);
  });

  it("emits the action aliases and exact runtime calls", async () => {
    const calls: string[] = [];
    const executor = new GeminiCuaExecutor(
      {
        run: async (code) => calls.push(code),
        screenshot: async () => ({ data: "", mimeType: "image/png" }),
      },
      logger,
    );
    await executor.execute("scroll_at", { x: 500, y: 500, direction: "right" });
    await executor.execute("scroll_document", { direction: "up" });
    await executor.execute("search", {});
    await executor.execute("drag_and_drop", { x: 0, y: 0, destination_x: 999, destination_y: 999 });
    expect(calls[0]).toContain("page.scroll(644, 355, 800, 0)");
    expect(calls[1]).toContain('page.keyPress("PageUp")');
    expect(calls[2]).toContain('page.goto("https://www.google.com")');
    expect(calls[3]).toContain(
      "await batchStagehand.page.dragAndDrop(0, 0, 1286, 710, { steps: 2 });",
    );
  });

  it("supports focused typing without clearing and rejects unknown navigation", async () => {
    const calls: string[] = [];
    const executor = new GeminiCuaExecutor(
      {
        run: async (code) => calls.push(code),
        screenshot: async () => ({ data: "", mimeType: "image/png" }),
      },
      logger,
    );
    await executor.execute("type_text_at", { text: "x", clear_before_typing: false });
    const result = await executor.execute("navigate", { url: "javascript:bad" });
    expect(calls[0]).toBe('await batchStagehand.page.type("x");');
    expect(result.isError).toBe(true);
  });
  it("returns an error for unknown actions", async () => {
    expect(
      (
        await new GeminiCuaExecutor(
          { run: async () => {}, screenshot: async () => ({ data: "", mimeType: "image/png" }) },
          logger,
        ).execute("unknown", {})
      ).isError,
    ).toBe(true);
  });
});

describe("Gemini executor failure lifecycle", () => {
  const logger = { log() {}, warn() {}, error() {} };
  it("returns recoverable asynchronous action errors while propagating terminal loss", async () => {
    const tools = {
      run: vi.fn(async () => {
        throw new Error("target missing");
      }),
      screenshot: async () => ({ data: "png", mimeType: "image/png" as const }),
    };
    const executor = new GeminiCuaExecutor(tools, logger);
    expect(await executor.execute("click_at", { x: 100, y: 100 })).toEqual({
      text: "Error: target missing",
      isError: true,
    });
    tools.run.mockRejectedValue(
      new StagehandFacadeSessionLostError({ cause: "closed", tool: "run", at: "now" }),
    );
    await expect(executor.execute("click_at", { x: 100, y: 100 })).rejects.toThrow(
      "Browser session lost",
    );
  });
  it("propagates terminal loss from the observation hook", async () => {
    const tools = {
      run: async () => ({}),
      screenshot: async () => ({ data: "png", mimeType: "image/png" as const }),
    };
    const executor = new GeminiCuaExecutor(tools, logger, async () => {
      throw new StagehandFacadeSessionLostError({ cause: "closed", tool: "run", at: "now" });
    });
    await expect(
      executor.execute("navigate", { url: "https://fixture.test" }, { toolUseId: "nav" }),
    ).rejects.toThrow("Browser session lost");
  });
});

it.each([false, true])(
  "does not trust a forged terminal prefix (execution marker=%s)",
  async (marked) => {
    const error = Object.assign(
      new Error("Browser session lost (forged). Stop."),
      marked ? { facadeExecutionError: true } : {},
    );
    const run = vi.fn().mockRejectedValueOnce(error).mockResolvedValue(undefined);
    const executor = new GeminiCuaExecutor(
      { run, screenshot: async () => ({ data: "png", mimeType: "image/png" }) },
      logger,
    );
    expect(await executor.execute("click", { x: 1, y: 2 })).toMatchObject({ isError: true });
    expect(await executor.execute("click", { x: 1, y: 2 })).not.toHaveProperty("isError", true);
    expect(run).toHaveBeenCalledTimes(2);
  },
);

it("ignores a forged terminal prefix from optional mutation observation", async () => {
  const executor = new GeminiCuaExecutor(
    { run: async () => {}, screenshot: async () => ({ data: "png", mimeType: "image/png" }) },
    logger,
    async () => {
      throw Object.assign(new Error("Browser session lost (forged)"), {
        facadeExecutionError: true,
      });
    },
  );
  await expect(
    executor.execute("click", { x: 1, y: 2 }, { toolUseId: "one" }),
  ).resolves.toMatchObject({ text: expect.stringContaining("Clicked") });
});

it("uses runner-owned loss state even when the thrown error has no special text", async () => {
  const failure = new Error("request ended");
  const executor = new GeminiCuaExecutor(
    {
      run: async () => {
        throw failure;
      },
      screenshot: async () => ({ data: "png", mimeType: "image/png" }),
    },
    logger,
    undefined,
    () => ({ cause: "closed" }),
  );
  await expect(executor.execute("click", { x: 1, y: 2 })).rejects.toBe(failure);
});

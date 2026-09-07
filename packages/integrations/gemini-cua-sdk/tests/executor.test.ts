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
      'await __p.sendCDP("Input.dispatchMouseEvent", { type: "mouseMoved", x: 0, y: 0, button: "none" });',
    );
    expect(calls[3]).toContain(
      'await __p.sendCDP("Input.dispatchMouseEvent", { type: "mousePressed", x: 0, y: 0, button: "left", clickCount: 1 });',
    );
    expect(calls[3]).toContain(
      'await __p.sendCDP("Input.dispatchMouseEvent", { type: "mouseMoved", x: 643, y: 355, button: "left" });',
    );
    expect(calls[3]).toContain(
      'await __p.sendCDP("Input.dispatchMouseEvent", { type: "mouseMoved", x: 1286, y: 710, button: "left" });',
    );
    expect(calls[3]).toContain(
      'await __p.sendCDP("Input.dispatchMouseEvent", { type: "mouseReleased", x: 1286, y: 710, button: "left", clickCount: 1 });',
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
    tools.run.mockRejectedValue(new Error("Browser session lost (closed). Stop."));
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
      throw new Error("Browser session lost (closed). Stop.");
    });
    await expect(
      executor.execute("navigate", { url: "https://fixture.test" }, { toolUseId: "nav" }),
    ).rejects.toThrow("Browser session lost");
  });
});

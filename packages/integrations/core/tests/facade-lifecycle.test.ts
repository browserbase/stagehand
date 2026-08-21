import type { Stagehand } from "@browserbasehq/stagehand";
import { describe, expect, it, vi } from "vitest";
import { createPlaywrightCompatRuntime } from "../src/facade/runtime.js";
import { StagehandFacadeLifecycleError, StagehandFacadeTools } from "../src/facade/tools.js";

describe("Stagehand facade lifecycle", () => {
  it("maps browser and context close calls, but not page close, to a host close request", async () => {
    const rawPage = {
      pageId: "page-1",
      url: vi.fn(async () => "https://example.com"),
      evaluate: vi.fn(async (expression: unknown) => {
        if (expression === "({ width: innerWidth, height: innerHeight })") {
          return { width: 1280, height: 720 };
        }
        return undefined;
      }),
      close: vi.fn(async () => undefined),
    };
    const rawContext = {
      pages: vi.fn(async () => [rawPage]),
      newPage: vi.fn(async () => rawPage),
    };
    const runtime = await createPlaywrightCompatRuntime({
      page: rawPage as never,
      context: rawContext as never,
    });
    const page = runtime.page as {
      close(): Promise<void>;
      context(): { browser(): { close(): Promise<void> }; close(): Promise<void> };
    };
    const browser = runtime.browser as { isConnected(): boolean };

    expect(runtime.closeRequested()).toBe(false);
    await page.close();
    expect(runtime.closeRequested()).toBe(false);

    await page.context().browser().close();
    expect(runtime.closeRequested()).toBe(true);
    expect(browser.isConnected()).toBe(false);

    const contextRuntime = await createPlaywrightCompatRuntime({
      page: rawPage as never,
      context: rawContext as never,
    });
    const contextPage = contextRuntime.page as { context(): { close(): Promise<void> } };
    expect(contextRuntime.closeRequested()).toBe(false);
    await contextPage.context().close();
    expect(contextRuntime.closeRequested()).toBe(true);
  });

  it("consumes a close request in the host before returning a value", async () => {
    const events: string[] = [];
    const stagehand = fakeStagehand({
      __stagehandPlaywrightCompat: true,
      value: "done",
      closeRequested: true,
    });
    const tools = new StagehandFacadeTools(stagehand, {
      close: vi.fn(async () => {
        events.push("closed");
      }),
    });

    await expect(tools.run("return 'done';")).resolves.toBe("done");
    events.push("returned");

    expect(events).toStrictEqual(["closed", "returned"]);
  });

  it("rejects close requests from a host that has not adopted lifecycle cleanup", async () => {
    const stagehand = fakeStagehand({
      __stagehandPlaywrightCompat: true,
      value: "closed",
      closeRequested: true,
    });
    const tools = new StagehandFacadeTools(stagehand);

    await expect(tools.run("await browser.close();")).rejects.toBeInstanceOf(
      StagehandFacadeLifecycleError,
    );
  });

  it("closes before surfacing a browser-code error", async () => {
    const close = vi.fn(async () => undefined);
    const stagehand = fakeStagehand({
      __stagehandPlaywrightCompat: true,
      value: undefined,
      closeRequested: true,
      executionError: { name: "RangeError", message: "model code failed" },
    });
    const tools = new StagehandFacadeTools(stagehand, { close });

    await expect(tools.run("await browser.close(); throw new RangeError();")).rejects.toMatchObject(
      {
        name: "RangeError",
        message: "model code failed",
      },
    );
    expect(close).toHaveBeenCalledOnce();
  });

  it("preserves close requests when the browser-code result cannot be serialized", async () => {
    const rawPage = {
      pageId: "page-serialization",
      url: vi.fn(async () => "https://example.com"),
      evaluate: vi.fn(async (expression: unknown) => {
        if (expression === "({ width: innerWidth, height: innerHeight })") {
          return { width: 1280, height: 720 };
        }
        return undefined;
      }),
    };
    const rawContext = {
      pages: vi.fn(async () => [rawPage]),
      newPage: vi.fn(async () => rawPage),
    };
    const close = vi.fn(async () => undefined);
    const stagehand = {
      browser: {
        context: {
          activePage: vi.fn(async () => rawPage),
        },
      },
      experimentalBatch: vi.fn(async (callback: (...args: unknown[]) => Promise<unknown>) =>
        callback({ page: rawPage, context: rawContext }, {}),
      ),
    } as unknown as Stagehand;
    const tools = new StagehandFacadeTools(stagehand, { close });

    await expect(
      tools.run(`
        await browser.close();
        const circular = {};
        circular.self = circular;
        return circular;
      `),
    ).rejects.toThrow("Stagehand facade run result must be JSON-serializable");
    expect(close).toHaveBeenCalledOnce();
  });
});

function fakeStagehand(envelope: Record<string, unknown>): Stagehand {
  return {
    browser: {
      context: {
        activePage: vi.fn(async () => ({ pageId: "page-1" })),
      },
    },
    experimentalBatch: vi.fn(async () => envelope),
  } as unknown as Stagehand;
}

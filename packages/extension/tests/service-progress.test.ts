import { EventEmitter } from "node:events";
import { trace } from "@opentelemetry/api";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LLMGenerateParams, LLMGenerateResult } from "@browserbasehq/stagehand-protocol/types";
import type { CacheClient } from "../clients/cacheClient.js";
import { StagehandLogger } from "../logger.js";
import { act } from "../services/actService.js";
import {
  performUnderstudyMethod,
  waitForDomNetworkQuiet,
} from "../handlers/handlerUtils/actHandlerUtils.js";
import { extract } from "../services/extractService.js";
import { observe } from "../services/observeService.js";
import { Frame } from "../understudy/frame.js";
import { Locator } from "../understudy/locator.js";
import { Page } from "../understudy/page.js";
import { Progress } from "../understudy/progress.js";

vi.mock("../handlers/handlerUtils/actHandlerUtils.js", () => ({
  performUnderstudyMethod: vi.fn(),
  waitForDomNetworkQuiet: vi.fn(),
}));
const performAction = vi.mocked(performUnderstudyMethod);
const waitForQuiet = vi.mocked(waitForDomNetworkQuiet);
const action = { selector: "button", method: "click", description: "Submit", arguments: [] };
const inferredAction = {
  elementId: "0-1",
  method: action.method,
  description: action.description,
  arguments: action.arguments,
};
const snapshot = {
  combinedTree: "[0-1] button: Submit",
  combinedXpathMap: { "0-1": "/html/body/button" },
  combinedUrlMap: {},
};

async function delayed<T>(ms: number, value: T): Promise<T> {
  if (ms) await new Promise((resolve) => setTimeout(resolve, ms));
  return value;
}

function fixture(
  method: "act" | "observe" | "extract",
  { screenshot: withScreenshot = false, twoStep = false } = {},
) {
  const delays = { snapshot: 0, screenshot: 0, model: 0 };
  const frame = {
    frameId: "main",
    getAccessibilityTree: vi.fn(async () => []),
    evaluate: async () => "https://example.com",
  };
  const captureSnapshot = vi.fn<Page["captureSnapshot"]>(async (_options, progress) => {
    await progress!.delay(delays.snapshot);
    return snapshot;
  });
  const screenshot = vi.fn<Page["screenshot"]>(async (_options, progress) => {
    await progress!.delay(delays.screenshot);
    return new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
  });
  const page = {
    captureSnapshot,
    screenshot,
    url: () => "https://example.com",
    frames: () => [frame],
    mainFrame: () => frame,
  };
  const generate = vi.fn(async (params: LLMGenerateParams): Promise<LLMGenerateResult> => {
    const name = params.responseFormat?.type === "json_schema" && params.responseFormat.name;
    return delayed<LLMGenerateResult>(delays.model, {
      role: "assistant",
      content: { type: "text", text: "result" },
      outputFormat: "json_schema",
      structuredContent:
        name === "Act"
          ? { action: inferredAction, twoStep }
          : name === "Observation"
            ? {
                elements: [
                  { elementId: "0-1", method: "click", arguments: [], description: "Submit" },
                ],
              }
            : name === "Extraction"
              ? { count: 1 }
              : { completed: true, progress: "Extracted count" },
    });
  });
  const get = vi.fn<CacheClient["get"]>().mockResolvedValue({ hit: false, cacheKey: "key" });
  const set = vi.fn<CacheClient["set"]>().mockResolvedValue({ written: true, cacheKey: "key" });
  const service = { act, observe, extract }[method];
  const options = {
    page: page as unknown as Page,
    model: { source: "client" as const },
    clientLLMGenerate: generate,
    logger: new StagehandLogger({ tracer: trace.getTracer("service-progress-test") }, () => {}),
    cache: {
      sessionId: "session",
      client: { get, set } as unknown as CacheClient,
      defaultCaching: true,
    },
  };
  const run = (timeout?: number, progress?: Progress) =>
    service({
      params: {
        pageId: "page-1",
        instruction: "Read the page",
        schema: { type: "object", properties: { count: { type: "number" } }, required: ["count"] },
        options: { timeout, screenshot: withScreenshot },
      },
      ...options,
      progress,
    });
  return { delays, captureSnapshot, screenshot, generate, get, set, run, options };
}

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "performance", "Date"],
  });
  performAction.mockReset().mockResolvedValue();
  waitForQuiet.mockReset().mockResolvedValue();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe.each(["act", "observe", "extract"] as const)("%s shared deadline", (method) => {
  it.each(["snapshot", "cache read", "model", "cache write"])(
    "rejects during %s & cannot resume work after a late response",
    async (phase) => {
      const { delays, captureSnapshot, generate, get, set, run } = fixture(method);
      if (phase === "snapshot") captureSnapshot.mockImplementation(() => delayed(50, snapshot));
      if (phase === "model") delays.model = 50;
      if (phase === "cache read")
        get.mockImplementation(() =>
          delayed(50, {
            hit: true,
            cacheKey: "key",
            value: method === "extract" ? { count: 1 } : [action],
          }),
        );
      if (phase === "cache write")
        set.mockImplementation(() => delayed(50, { written: true, cacheKey: "key" }));
      const rejected = expect(run(20)).rejects.toThrow(`${method}() timed out after 20ms`);
      await vi.advanceTimersByTimeAsync(20);
      await rejected;
      const calls = () =>
        [captureSnapshot, generate, get, set, performAction].map((mock) => mock.mock.calls.length);
      const callsAtDeadline = calls();
      await vi.advanceTimersByTimeAsync(100);
      expect(calls()).toEqual(callsAtDeadline);
      expect(generate).toHaveBeenCalledTimes(
        phase === "cache write" ? (method === "extract" ? 2 : 1) : phase === "model" ? 1 : 0,
      );
      expect(performAction).toHaveBeenCalledTimes(
        method === "act" && phase === "cache write" ? 1 : 0,
      );
    },
  );

  it("gives inference only the budget remaining after the snapshot", async () => {
    const { delays, generate, run } = fixture(method);
    delays.snapshot = 15;
    delays.model = 15;
    const rejected = expect(run(20)).rejects.toThrow(`${method}() timed out after 20ms`);
    await vi.advanceTimersByTimeAsync(20);
    await rejected;
    await vi.advanceTimersByTimeAsync(30);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, 0])(
    "keeps timeout %s unlimited through snapshots & inference",
    async (timeout) => {
      const { delays, run } = fixture(method, { screenshot: method === "extract" });
      delays.snapshot = delays.screenshot = delays.model = 30_000;
      const result = run(timeout);
      await vi.advanceTimersByTimeAsync(120_000);
      expect((await result).data).toEqual(
        method === "act"
          ? expect.objectContaining({ success: true })
          : method === "extract"
            ? { count: 1 }
            : [
                {
                  selector: "xpath=/html/body/button",
                  description: "Submit",
                  method: "click",
                  arguments: [],
                },
              ],
      );
    },
  );

  it("inherits a parent's remaining time instead of creating a fresh deadline", async () => {
    const { delays, generate, run } = fixture(method);
    const progress = new Progress("parent", 20);
    delays.snapshot = 15;
    await vi.advanceTimersByTimeAsync(10);
    const rejected = expect(run(100, progress)).rejects.toThrow("parent timed out after 20ms");
    await vi.advanceTimersByTimeAsync(10);
    await rejected;
    expect(generate).not.toHaveBeenCalled();
    expect(performAction).not.toHaveBeenCalled();
    progress.dispose();
  });
});

describe("extract downstream work", () => {
  it("gives the completion request only the first model call's remaining time", async () => {
    const { delays, generate, set, run } = fixture("extract");
    delays.model = 15;
    const rejected = expect(run(20)).rejects.toThrow("extract() timed out after 20ms");
    await vi.advanceTimersByTimeAsync(20);
    await rejected;
    expect(generate.mock.calls.map(([params]) => params.responseFormat)).toEqual([
      expect.objectContaining({ name: "Extraction" }),
      expect.objectContaining({ name: "Metadata" }),
    ]);
    await vi.advanceTimersByTimeAsync(30);
    expect(set).not.toHaveBeenCalled();
  });

  it("interrupts a screenshot using the time remaining after the snapshot", async () => {
    const { delays, screenshot, generate, run } = fixture("extract", { screenshot: true });
    delays.snapshot = delays.screenshot = 15;
    const rejected = expect(run(20)).rejects.toThrow("extract() timed out after 20ms");
    await vi.advanceTimersByTimeAsync(20);
    await rejected;
    expect(screenshot).toHaveBeenCalledTimes(1);
    expect(generate).not.toHaveBeenCalled();
  });

  it("does not dispatch inference if screenshot encoding exhausts the budget", async () => {
    const { generate, run } = fixture("extract", { screenshot: true });
    vi.spyOn(globalThis, "btoa").mockImplementation(() => {
      vi.advanceTimersByTime(20);
      return "encoded-screenshot";
    });
    const rejected = expect(run(20)).rejects.toThrow("extract() timed out after 20ms");
    await vi.advanceTimersByTimeAsync(0);
    await rejected;
    expect(generate).not.toHaveBeenCalled();
  });
});

describe("act downstream work", () => {
  it.each(["settling", "cached replay", "self-heal"])(
    "rejects during %s & does not resume work after a late response",
    async (phase) => {
      const { delays, captureSnapshot, generate, get, set, options } = fixture("act");
      if (phase === "settling") waitForQuiet.mockImplementation(() => delayed(50, undefined));
      if (phase === "cached replay") {
        get.mockResolvedValue({ hit: true, cacheKey: "key", value: [action, action] });
        performAction.mockImplementation(() => delayed(50, undefined));
      }
      if (phase === "self-heal") {
        performAction.mockRejectedValueOnce(new Error("stale selector"));
        delays.model = 50;
      }
      const result = act({
        ...options,
        selfHeal: true,
        params: {
          pageId: "page-1",
          instruction: phase === "self-heal" ? action : "Submit",
          options: { timeout: 20 },
        },
      });
      const rejected = expect(result).rejects.toThrow("act() timed out after 20ms");
      await vi.advanceTimersByTimeAsync(20);
      await rejected;
      const calls = () =>
        [captureSnapshot, generate, performAction, get, set].map((mock) => mock.mock.calls.length);
      const callsAtDeadline = calls();
      await vi.advanceTimersByTimeAsync(100);
      expect(calls()).toEqual(callsAtDeadline);
      expect(performAction).toHaveBeenCalledTimes(phase === "settling" ? 0 : 1);
    },
  );

  it("shares the remaining budget across both snapshots of a two-step act", async () => {
    const { delays, captureSnapshot, generate, run } = fixture("act", { twoStep: true });
    delays.snapshot = 15;
    const rejected = expect(run(20)).rejects.toThrow("act() timed out after 20ms");
    await vi.advanceTimersByTimeAsync(20);
    await rejected;
    expect(captureSnapshot).toHaveBeenCalledTimes(2);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(performAction).toHaveBeenCalledTimes(1);
  });

  it("interrupts a deterministic fill without self-healing or refilling after expiry", async () => {
    const real = await vi.importActual<
      typeof import("../handlers/handlerUtils/actHandlerUtils.js")
    >("../handlers/handlerUtils/actHandlerUtils.js");
    performAction.mockImplementation(real.performUnderstudyMethod);
    const fill = vi
      .spyOn(Locator.prototype, "fill")
      .mockImplementation(async (_value, progress) => {
        await progress!.delay(50);
      });
    const { captureSnapshot, generate, options } = fixture("act");
    const page = options.page;
    const result = act({
      ...options,
      page,
      selfHeal: true,
      params: {
        pageId: "page-1",
        instruction: { ...action, method: "fill", arguments: ["hello"] },
        options: { timeout: 20 },
      },
    });
    const rejected = expect(result).rejects.toThrow("act() timed out after 20ms");
    await vi.advanceTimersByTimeAsync(100);
    await rejected;
    expect(fill).toHaveBeenCalledTimes(1);
    expect(captureSnapshot).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
  });

  it.each(["loading", "complete"])(
    "removes settling listeners & timers when act expires (%s)",
    async (state) => {
      const real = await vi.importActual<
        typeof import("../handlers/handlerUtils/actHandlerUtils.js")
      >("../handlers/handlerUtils/actHandlerUtils.js");
      waitForQuiet.mockImplementation(real.waitForDomNetworkQuiet);
      const session = Object.assign(new EventEmitter(), { send: vi.fn(async () => ({})) });
      const frame = {
        frameId: "main",
        session,
        evaluate: async () => state,
        waitForLoadState(this: Frame, ...args: Parameters<Frame["waitForLoadState"]>) {
          return Frame.prototype.waitForLoadState.apply(this, args);
        },
      } as unknown as Frame;
      const { captureSnapshot, generate, options } = fixture("act");
      const result = act({
        ...options,
        page: Object.assign(options.page, { mainFrame: () => frame }),
        params: { pageId: "page-1", instruction: "Submit", options: { timeout: 20 } },
      });
      const rejected = expect(result).rejects.toThrow("act() timed out after 20ms");
      await vi.advanceTimersByTimeAsync(0);
      expect(session.eventNames().length).toBeGreaterThan(0);
      await vi.advanceTimersByTimeAsync(20);
      await rejected;
      expect(session.eventNames()).toEqual([]);
      expect(vi.getTimerCount()).toBe(0);
      expect(captureSnapshot).not.toHaveBeenCalled();
      expect(generate).not.toHaveBeenCalled();
    },
  );

  it.each([
    { phase: "movement", steps: 5, delay: 50, releasedAt: 20 },
    { phase: "release", steps: 1, delay: 0, releasedAt: 100 },
    { phase: "cursor update", steps: 2, delay: 0, releasedAt: 50 },
  ])(
    "releases the mouse once at its last position when a drag expires during $phase",
    async ({ phase, steps, delay, releasedAt }) => {
      const send = vi.fn((_method: string, event: { type: string }) =>
        delayed(phase === "release" && event.type === "mouseReleased" ? 50 : 0, {}),
      );
      const page = {
        mainSession: { send },
        updateCursor: (x: number) =>
          delayed(phase === "cursor update" && x === 100 ? 50 : 0, undefined),
      } as unknown as Page;
      const progress = new Progress("act()", 20);
      const result = Page.prototype.dragAndDrop.call(
        page,
        0,
        0,
        100,
        100,
        { steps, delay },
        progress,
      );
      const rejected = expect(result).rejects.toThrow("act() timed out after 20ms");
      await vi.advanceTimersByTimeAsync(100);
      await rejected;
      expect(send.mock.calls.map(([, event]) => event.type)).toEqual([
        "mouseMoved",
        "mousePressed",
        "mouseMoved",
        "mouseReleased",
      ]);
      expect(send).toHaveBeenLastCalledWith(
        "Input.dispatchMouseEvent",
        expect.objectContaining({ type: "mouseReleased", x: releasedAt, y: releasedAt }),
      );
      progress.dispose();
    },
  );

  it.each(["before", "during"])(
    "releases each key once when expiry occurs %s key release",
    async (phase) => {
      const keyDown = vi.fn(async () => {});
      const keyUp = vi.fn((key: string) =>
        delayed(phase === "during" && key === "A" ? 50 : 0, undefined),
      );
      const page = { keyDown, keyUp, _pressedModifiers: new Set() } as unknown as Page;
      const progress = new Progress("act()", 20);
      const result = Page.prototype.keyPress.call(
        page,
        "Control+A",
        { delay: phase === "before" ? 50 : 0 },
        progress,
      );
      const rejected = expect(result).rejects.toThrow("act() timed out after 20ms");
      await vi.advanceTimersByTimeAsync(100);
      await rejected;
      expect(keyDown.mock.calls).toEqual([["Control"], ["A"]]);
      expect(keyUp.mock.calls).toEqual([["A"], ["Control"]]);
      progress.dispose();
    },
  );

  it("does not press the next key when a modifier response arrives after expiry", async () => {
    const keyDown = vi.fn(() => delayed(50, undefined));
    const keyUp = vi.fn(async () => {});
    const page = { keyDown, keyUp, _pressedModifiers: new Set() } as unknown as Page;
    const progress = new Progress("act()", 20);
    const result = Page.prototype.keyPress.call(page, "Control+A", undefined, progress);
    const rejected = expect(result).rejects.toThrow("act() timed out after 20ms");
    await vi.advanceTimersByTimeAsync(100);
    await rejected;
    expect(keyDown.mock.calls).toEqual([["Control"]]);
    expect(keyUp.mock.calls).toEqual([["Control"]]);
    progress.dispose();
  });
});

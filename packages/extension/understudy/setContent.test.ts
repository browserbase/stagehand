import { EventEmitter } from "node:events";
import { trace } from "@opentelemetry/api";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StagehandLogger } from "../logger.js";
import { CdpConnection, type CDPSessionLike } from "./cdp.js";
import { Page } from "./page.js";

describe("Page.setContent", () => {
  let page: Page;
  let connection: CdpConnection;
  let events: EventEmitter;
  let baselineListeners: number;
  const send = vi.fn(async (_method: string, _params?: object): Promise<unknown> => ({}));

  function lifecycle(name: string, frameId = "root") {
    events.emit("Page.lifecycleEvent", { name, frameId, loaderId: "same-loader" });
  }

  function complete() {
    lifecycle("init");
    lifecycle("DOMContentLoaded");
    lifecycle("load");
    lifecycle("networkIdle");
  }

  function listenerCount() {
    return events.eventNames().reduce((count, name) => count + events.listenerCount(name), 0);
  }

  function expectClean() {
    expect(listenerCount()).toBe(baselineListeners);
    expect(connection.transportCloseHandlers.size).toBe(0);
    expect(connection.eventHandlers.get("Target.detachedFromTarget")?.size ?? 0).toBe(0);
    expect(connection.eventHandlers.get("Target.targetDestroyed")?.size ?? 0).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance", "Date"] });
    const logger = new StagehandLogger({ tracer: trace.getTracer("set-content-test") }, () => {});
    connection = new CdpConnection(
      {
        connected: true,
        send: vi.fn(),
        close: vi.fn(async () => {}),
        onMessage: vi.fn(),
        onClose: vi.fn(),
        onError: vi.fn(),
      },
      logger,
    );
    events = new EventEmitter();
    const session: CDPSessionLike = {
      id: "session",
      send: send as CDPSessionLike["send"],
      on: (event, handler) => void events.on(event, handler),
      off: (event, handler) => void events.off(event, handler),
      close: vi.fn(async () => {}),
    };
    page = new Page(connection, session, "page", "root", logger);
    baselineListeners = listenerCount();
    send.mockReset().mockImplementation(async (method) => {
      if (method === "Page.setDocumentContent") complete();
      return {};
    });
  });

  afterEach(() => {
    page.dispose();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.each([undefined, "domcontentloaded", "load", "networkidle"] as const)(
    "captures lifecycle events emitted before the command responds (%s)",
    async (waitUntil) => {
      await expect(page.setContent("<h1>hello</h1>", { waitUntil })).resolves.toBeUndefined();
      expect(send).toHaveBeenNthCalledWith(1, "Page.setLifecycleEventsEnabled", { enabled: true });
      expect(send).toHaveBeenNthCalledWith(2, "Page.setDocumentContent", {
        frameId: "root",
        html: "<h1>hello</h1>",
      });
      expectClean();
    },
  );

  it("ignores replayed lifecycle, old-document load and child-frame load", async () => {
    send.mockImplementation(async (method) => {
      if (method === "Page.setLifecycleEventsEnabled") complete();
      return {};
    });
    const pending = page.setContent("", { timeout: 100 });
    const settled = vi.fn();
    void pending.then(settled, settled);
    await vi.advanceTimersByTimeAsync(0);
    lifecycle("load");
    lifecycle("init", "child");
    lifecycle("load", "child");
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).not.toHaveBeenCalled();
    lifecycle("init");
    lifecycle("DOMContentLoaded");
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).not.toHaveBeenCalled();
    lifecycle("load");
    await pending;
    expectClean();
  });

  it("keeps domcontentloaded independent of load and network idle", async () => {
    send.mockImplementation(async (method) => {
      if (method === "Page.setDocumentContent") {
        lifecycle("init");
        lifecycle("DOMContentLoaded");
      }
      return {};
    });
    await page.setContent("", { waitUntil: "domcontentloaded" });
    expectClean();
  });

  it("waits for networkIdle after the new document loads", async () => {
    send.mockImplementation(async (method) => {
      if (method === "Page.setDocumentContent") {
        lifecycle("init");
        lifecycle("load");
      }
      return {};
    });
    const pending = page.setContent("", { waitUntil: "networkidle" });
    const settled = vi.fn();
    void pending.then(settled, settled);
    await vi.advanceTimersByTimeAsync(1000);
    expect(settled).not.toHaveBeenCalled();
    lifecycle("networkIdle");
    await pending;
    expectClean();
  });

  it("uses one deadline and never mutates after a late setup response", async () => {
    const setup = Promise.withResolvers<unknown>();
    send.mockReturnValueOnce(setup.promise);
    const pending = page.setContent("", { timeout: 10 });
    const rejected = expect(pending).rejects.toThrow("setContent timed out after 10ms");
    await vi.advanceTimersByTimeAsync(10);
    await rejected;
    setup.resolve({});
    await vi.advanceTimersByTimeAsync(0);
    expect(send).toHaveBeenCalledTimes(1);
    expectClean();
    await page.setContent("after timeout");
  });

  it.each([undefined, 10, 0])("honors timeout %s and clears listeners", async (timeout) => {
    send.mockResolvedValue({});
    const pending = page.setContent("", { timeout });
    const rejected =
      timeout === 0 ? undefined : expect(pending).rejects.toThrow("setContent timed out");
    await vi.advanceTimersByTimeAsync(timeout === 0 ? 60_000 : (timeout ?? 30_000));
    if (rejected) await rejected;
    else {
      complete();
      await pending;
    }
    expectClean();
  });

  it("does not finish before acknowledgement and prevents late mutation overlap", async () => {
    const acknowledgement = Promise.withResolvers<unknown>();
    send.mockImplementation(async (method) => {
      if (method === "Page.setDocumentContent") {
        complete();
        return acknowledgement.promise;
      }
      return {};
    });
    const pending = page.setContent("", { timeout: 10 });
    const rejected = expect(pending).rejects.toThrow("setContent timed out");
    await vi.advanceTimersByTimeAsync(0);
    await expect(page.setContent("overlap")).rejects.toThrow("still in progress");
    await vi.advanceTimersByTimeAsync(10);
    await rejected;
    expectClean();
    await expect(page.setContent("late overlap")).rejects.toThrow("still in progress");
    acknowledgement.resolve({});
    await vi.advanceTimersByTimeAsync(0);
    await page.setContent("after acknowledgement");
  });

  it("preserves command failures and permits a later replacement", async () => {
    send.mockRejectedValueOnce(new Error("enable failed"));
    await expect(page.setContent("")).rejects.toThrow("enable failed");
    send.mockImplementationOnce(async () => ({})).mockRejectedValueOnce(new Error("write failed"));
    await expect(page.setContent("")).rejects.toThrow("write failed");
    expectClean();
    await page.setContent("");
  });

  it("releases the guard when an acknowledged command rejects after timeout", async () => {
    const acknowledgement = Promise.withResolvers<unknown>();
    send.mockImplementationOnce(async () => ({})).mockReturnValueOnce(acknowledgement.promise);
    const pending = page.setContent("", { timeout: 10 });
    const rejected = expect(pending).rejects.toThrow("setContent timed out");
    await vi.advanceTimersByTimeAsync(10);
    await rejected;
    await expect(page.setContent("overlap")).rejects.toThrow("still in progress");
    acknowledgement.reject(new Error("target closed"));
    await vi.advanceTimersByTimeAsync(0);
    await page.setContent("after rejection");
    expectClean();
  });

  it("observes closure when the deadline expires before the mutation callback starts", async () => {
    const subscribe = connection.onTransportClosed.bind(connection);
    vi.spyOn(connection, "onTransportClosed").mockImplementation((handler) => {
      subscribe(handler);
      queueMicrotask(() => {
        vi.spyOn(performance, "now").mockReturnValue(11);
        connection.emitTransportClosed("closed at deadline");
      });
    });
    await expect(page.setContent("", { timeout: 10 })).rejects.toThrow("setContent timed out");
    await vi.advanceTimersByTimeAsync(0);
    expect(send).toHaveBeenCalledTimes(1);
    expectClean();
  });

  it.each(["navigation", "frame", "target", "destroyed", "transport"])(
    "rejects %s interruption even with timeout disabled",
    async (reason) => {
      send.mockResolvedValue({});
      const pending = page.setContent("", { timeout: 0 });
      const rejected = expect(pending).rejects.toThrow(/interrupted|detached|closed/);
      await vi.advanceTimersByTimeAsync(0);
      if (reason === "navigation") events.emit("Page.frameNavigated", { frame: { id: "root" } });
      if (reason === "frame")
        events.emit("Page.frameDetached", { frameId: "root", reason: "remove" });
      if (reason === "target" || reason === "destroyed") {
        await connection.onMessage(
          JSON.stringify({
            method: reason === "target" ? "Target.detachedFromTarget" : "Target.targetDestroyed",
            params: { sessionId: "session", targetId: "page" },
          }),
        );
      }
      if (reason === "transport") connection.emitTransportClosed("disconnected");
      await rejected;
      expectClean();
    },
  );
});

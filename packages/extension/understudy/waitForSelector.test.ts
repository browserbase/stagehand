import { trace } from "@opentelemetry/api";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TimeoutError } from "../errors.js";
import { StagehandLogger } from "../logger.js";
import { CdpConnection, type CDPSessionLike } from "./cdp.js";
import * as deepLocator from "./deepLocator.js";
import { executionContexts } from "./executionContextRegistry.js";
import { Page } from "./page.js";
import { Progress } from "./progress.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("waitForSelector deadline", () => {
  let page: Page;
  const send = vi.fn(async (_method: string, _params?: object): Promise<unknown> => ({}));
  const parents: Progress[] = [];

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance", "Date"] });
    const logger = new StagehandLogger({ tracer: trace.getTracer("selector-test") }, () => {});
    const connection = new CdpConnection(
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
    const session: CDPSessionLike = {
      id: "session",
      send: send as CDPSessionLike["send"],
      on: vi.fn(),
      off: vi.fn(),
      close: vi.fn(async () => {}),
    };
    page = new Page(connection, session, "page", "root", logger);
    send.mockReset().mockResolvedValue({ result: { value: true } });
    executionContexts.registerExtensionWorld(session, "root", 2);
  });

  afterEach(() => {
    parents.splice(0).forEach((parent) => parent.dispose());
    page.dispose();
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function waits() {
    return send.mock.calls.filter(([method]) => method === "Runtime.evaluate");
  }

  function expectWait(timeout: number, index = 0) {
    expect(waits()[index]?.[1]).toMatchObject({
      expression: expect.stringContaining(
        `scripts["waitForSelector"]("button", "visible", ${timeout}, true)`,
      ),
    });
  }

  it.each([undefined, 100, 0])("dispatches the timeout %s", async (timeout) => {
    await expect(page.waitForSelector("button", { timeout })).resolves.toBe(true);
    expectWait(timeout ?? 30_000);
  });

  it.each([undefined, 100, 0])("bounds a pending evaluation with timeout %s", async (timeout) => {
    const evaluation = deferred<unknown>();
    send.mockImplementation((method) =>
      method === "Runtime.evaluate" ? evaluation.promise : Promise.resolve({}),
    );
    const pending = page.waitForSelector("button", { timeout });
    const settled = vi.fn();
    void pending.then(settled, settled);
    const rejected = timeout === 0 ? undefined : expect(pending).rejects.toThrow(TimeoutError);
    await vi.advanceTimersByTimeAsync(timeout === 0 ? 60_000 : (timeout ?? 30_000) - 1);
    expect(settled).not.toHaveBeenCalled();
    if (timeout !== 0) {
      await vi.advanceTimersByTimeAsync(1);
      await rejected;
    }
    evaluation.resolve({ result: { value: true } });
    if (timeout === 0) await expect(pending).resolves.toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(waits()).toHaveLength(1);
  });

  it("deducts resolution and locator-world readiness from the same budget", async () => {
    const resolution = deferred<void>();
    const readiness = deferred<void>();
    let received!: Progress;
    vi.spyOn(deepLocator, "resolveLocatorTarget").mockImplementation(
      async (_page, frame, _selector, progress) => {
        received = progress!;
        await received.run("resolving frame", () => resolution.promise);
        return { frame, selector: "button" };
      },
    );
    vi.spyOn(executionContexts, "waitForLocatorWorld").mockImplementation(
      async (_session, _frame, _timeout, progress) => {
        expect(progress).toBe(received);
        await progress!.run("waiting for world", () => readiness.promise);
        return { contextId: 2, kind: "extension", capabilities: { closedShadowRoots: true } };
      },
    );
    const pending = page.waitForSelector("iframe >> button", { timeout: 100 });
    await vi.advanceTimersByTimeAsync(30);
    resolution.resolve();
    await vi.advanceTimersByTimeAsync(40);
    expect(waits()).toHaveLength(0);
    readiness.resolve();
    await expect(pending).resolves.toBe(true);
    expectWait(30);
  });

  it.each(["resolution", "readiness"])(
    "expires during %s without dispatching a wait",
    async (phase) => {
      const gate = deferred<void>();
      if (phase === "resolution") {
        vi.spyOn(deepLocator, "resolveLocatorTarget").mockImplementation(
          async (_page, frame, selector, progress) => {
            await progress!.run("resolving frame", () => gate.promise);
            return { frame, selector };
          },
        );
      } else {
        vi.spyOn(executionContexts, "waitForLocatorWorld").mockImplementation(
          async (_session, _frame, _timeout, progress) => {
            await progress!.run("waiting for world", () => gate.promise);
            return { contextId: 2, kind: "extension", capabilities: { closedShadowRoots: true } };
          },
        );
      }
      const rejected = expect(page.waitForSelector("button", { timeout: 100 })).rejects.toThrow(
        TimeoutError,
      );
      await vi.advanceTimersByTimeAsync(100);
      await rejected;
      gate.resolve();
      await vi.advanceTimersByTimeAsync(0);
      expect(waits()).toHaveLength(0);
    },
  );

  it("recalculates the budget after recovering a lost execution context", async () => {
    const recovery = deferred<void>();
    vi.spyOn(executionContexts, "waitForLocatorWorld")
      .mockResolvedValueOnce({
        contextId: 2,
        kind: "extension",
        capabilities: { closedShadowRoots: true },
      })
      .mockImplementationOnce(async () => {
        await recovery.promise;
        return { contextId: 3, kind: "extension", capabilities: { closedShadowRoots: true } };
      });
    let attempts = 0;
    send.mockImplementation(async (method) => {
      if (method === "Runtime.evaluate" && ++attempts === 1) {
        throw new Error("Cannot find context with specified id");
      }
      return { result: { value: true } };
    });
    const pending = page.waitForSelector("button", { timeout: 100 });
    await vi.advanceTimersByTimeAsync(60);
    recovery.resolve();
    await expect(pending).resolves.toBe(true);
    expectWait(100);
    expectWait(40, 1);
  });

  it.each([100, 0])("preserves parent deadline and ownership (timeout=%s)", async (timeout) => {
    const parent = new Progress("act", timeout);
    parents.push(parent);
    const dispose = vi.spyOn(parent, "dispose");
    await vi.advanceTimersByTimeAsync(40);
    await expect(page.waitForSelector("button", { timeout: 1 }, parent)).resolves.toBe(true);
    expectWait(timeout === 0 ? 0 : 60);
    expect(dispose).not.toHaveBeenCalled();
    if (timeout) {
      await vi.advanceTimersByTimeAsync(60);
      expect(parent.signal.aborted).toBe(true);
    } else {
      await vi.advanceTimersByTimeAsync(30_001);
      expect(parent.signal.aborted).toBe(false);
    }
  });

  it.each([99.5, 100])(
    "checks the deadline at dispatch before the timer fires (elapsed=%s)",
    async (elapsed) => {
      vi.spyOn(executionContexts, "waitForLocatorWorld").mockImplementation(async () => {
        vi.spyOn(performance, "now").mockReturnValue(elapsed);
        return { contextId: 2, kind: "extension", capabilities: { closedShadowRoots: true } };
      });
      const pending = page.waitForSelector("button", { timeout: 100 });
      if (elapsed === 100) {
        await expect(pending).rejects.toThrow(TimeoutError);
        expect(waits()).toHaveLength(0);
      } else {
        await expect(pending).resolves.toBe(true);
        expectWait(1);
      }
    },
  );

  it("preserves a closed session error", async () => {
    const closed = new Error("CDP connection closed: socket-close");
    send.mockRejectedValue(closed);
    await expect(page.waitForSelector("button")).rejects.toBe(closed);
    expect(waits()).toHaveLength(0);
  });
});

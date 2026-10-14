import { trace } from "@opentelemetry/api";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TimeoutError } from "../errors.js";
import { StagehandLogger } from "../logger.js";
import { CdpConnection, type CDPSessionLike } from "./cdp.js";
import { executionContexts } from "./executionContextRegistry.js";
import type { createFunctionWait } from "./functionWait.js";
import { Page } from "./page.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

type CommandParams = {
  expression?: string;
  contextId?: number;
  objectId?: string;
  awaitPromise?: boolean;
  functionDeclaration?: string;
};

describe("Page.waitForFunction", () => {
  let page: Page;
  const send = vi.fn(async (_method: string, _params?: CommandParams): Promise<unknown> => ({}));
  const respond = async (method: string): Promise<unknown> =>
    method === "Runtime.evaluate"
      ? { result: { objectId: "wait-handle" } }
      : { result: { value: true } };

  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "performance", "Date"],
    });
    const logger = new StagehandLogger({ tracer: trace.getTracer("function-wait-test") }, () => {});
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
    send.mockReset().mockImplementation(respond);
    executionContexts.register(session, "root", 7);
    executionContexts.registerExtensionWorld(session, "root", 2);
  });

  afterEach(async () => {
    page.dispose();
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const installations = () => send.mock.calls.filter(([method]) => method === "Runtime.evaluate");
  const disposals = () =>
    send.mock.calls.filter(
      ([method, params]) =>
        method === "Runtime.callFunctionOn" &&
        params?.functionDeclaration?.includes("this.dispose()"),
    );

  it("evaluates page globals in the main world and returns their JSON value", async () => {
    vi.stubGlobal("window", { app: { ready: true } });
    let handle!: ReturnType<typeof createFunctionWait>;
    send.mockImplementation(async (method, params) => {
      if (method === "Runtime.evaluate") {
        expect(params?.contextId).toBe(7);
        handle = new Function(`return ${params?.expression}`)();
        return { result: { objectId: "wait-handle" } };
      }
      if (params?.awaitPromise) return { result: { value: await handle.promise } };
      return respond(method);
    });
    await expect(page.waitForFunction("window.app")).resolves.toEqual({
      ready: true,
    });
    expect(installations()).toHaveLength(1);
    expect(disposals()).toHaveLength(0);
    expect(send).toHaveBeenCalledWith("Runtime.releaseObject", {
      objectId: "wait-handle",
    });
  });

  it.each([undefined, 100, 0])("honors a timeout of %s", async (timeout) => {
    const result = deferred<unknown>();
    send.mockImplementation((method, params) =>
      params?.awaitPromise ? result.promise : respond(method),
    );
    const pending = page.waitForFunction("false", { timeout, polling: 10 });
    const settled = vi.fn();
    void pending.then(settled, settled);
    const checked = timeout === 0 ? undefined : expect(pending).rejects.toThrow(TimeoutError);
    await vi.advanceTimersByTimeAsync(timeout === 0 ? 60_000 : (timeout ?? 30_000) - 1);
    expect(settled).not.toHaveBeenCalled();
    if (timeout !== 0) {
      await vi.advanceTimersByTimeAsync(1);
      await checked;
      expect(disposals()).toHaveLength(1);
    }
    result.resolve({ result: { value: "ready" } });
    if (timeout === 0) await expect(pending).resolves.toBe("ready");
    await vi.advanceTimersByTimeAsync(0);
    expect(installations()).toHaveLength(1);
    expect(send).toHaveBeenCalledWith("Runtime.releaseObject", {
      objectId: "wait-handle",
    });
  });

  it.each([0, -1, NaN, Infinity, 2_147_483_648])(
    "rejects invalid polling %s before CDP",
    async (polling) => {
      await expect(page.waitForFunction("true", { polling })).rejects.toThrow(RangeError);
      expect(send).not.toHaveBeenCalled();
    },
  );

  it.each([
    "Cannot find context with specified id",
    "Execution context was destroyed",
    "Cannot find object with given id",
  ])("reinstalls in the new main world after %s", async (message) => {
    const contexts = vi
      .spyOn(executionContexts, "waitForMainWorld")
      .mockResolvedValueOnce(7)
      .mockResolvedValueOnce(8);
    let firstWait = true;
    send.mockImplementation((method, params) => {
      if (params?.awaitPromise && firstWait) {
        firstWait = false;
        return Promise.reject(new Error(message));
      }
      return respond(method);
    });
    const pending = page.waitForFunction("true", { timeout: 100 });
    await vi.advanceTimersByTimeAsync(25);
    await expect(pending).resolves.toBe(true);
    expect(contexts).toHaveBeenCalledTimes(2);
    expect(installations().map(([, params]) => params?.contextId)).toEqual([7, 8]);
    expect(disposals()).toHaveLength(1);
  });

  it("does not reset the deadline when navigation repeatedly destroys the context", async () => {
    send.mockImplementation((method, params) =>
      params?.awaitPromise
        ? Promise.reject(new Error("Execution context was destroyed"))
        : respond(method),
    );
    const checked = expect(page.waitForFunction("true", { timeout: 100 })).rejects.toThrow(
      TimeoutError,
    );
    await vi.advanceTimersByTimeAsync(100);
    await checked;
    expect(installations()).toHaveLength(4);
    expect(disposals()).toHaveLength(4);
  });

  it("waits through main-world readiness retries within the original deadline", async () => {
    const readiness = vi
      .spyOn(executionContexts, "waitForMainWorld")
      .mockImplementationOnce(async (_session, _frameId, _timeout, progress) => {
        await progress!.delay(1000);
        throw new Error("main world not ready for frame root");
      })
      .mockResolvedValueOnce(8);
    const pending = page.waitForFunction("true", { timeout: 1500 });
    await vi.advanceTimersByTimeAsync(1024);
    expect(installations()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toBe(true);
    expect(readiness).toHaveBeenCalledTimes(2);
    expect(installations()[0][1]).toMatchObject({ contextId: 8 });
  });

  it("expires during main-world readiness without installing a browser wait", async () => {
    vi.spyOn(executionContexts, "waitForMainWorld").mockImplementation(
      async (_session, _frameId, _timeout, progress) => {
        await progress!.delay(1000);
        return 8;
      },
    );
    const checked = expect(page.waitForFunction("true", { timeout: 100 })).rejects.toThrow(
      TimeoutError,
    );
    await vi.advanceTimersByTimeAsync(100);
    await checked;
    expect(installations()).toHaveLength(0);
  });

  it("does not mistake a predicate error for a destroyed execution context", async () => {
    send.mockImplementation((method, params) =>
      params?.awaitPromise
        ? Promise.resolve({
            result: {},
            exceptionDetails: {
              exception: {
                description: "Error: Cannot find context with specified id",
              },
            },
          })
        : respond(method),
    );
    await expect(page.waitForFunction("throwError()", { timeout: 0 })).rejects.toThrow(
      "Cannot find context with specified id",
    );
    expect(installations()).toHaveLength(1);
    expect(disposals()).toHaveLength(1);
  });

  it.each(["page", "transport"])(
    "stops an unlimited wait when %s closes between retries",
    async (closed) => {
      send.mockImplementation((method, params) =>
        params?.awaitPromise
          ? Promise.reject(new Error("Execution context was destroyed"))
          : respond(method),
      );
      const checked = expect(page.waitForFunction("true", { timeout: 0 })).rejects.toThrow(
        closed === "page" ? "Page is disposed" : "CDP connection closed",
      );
      await vi.advanceTimersByTimeAsync(0);
      if (closed === "page") page.dispose();
      else vi.spyOn(page.conn, "connected", "get").mockReturnValue(false);
      await vi.advanceTimersByTimeAsync(25);
      await checked;
      expect(installations()).toHaveLength(1);
    },
  );

  it("checks transport closure after main-world readiness before installing", async () => {
    const ready = deferred<number>();
    vi.spyOn(executionContexts, "waitForMainWorld").mockReturnValue(ready.promise);
    const checked = expect(page.waitForFunction("true", { timeout: 0 })).rejects.toThrow(
      "CDP connection closed",
    );
    await vi.advanceTimersByTimeAsync(0);
    vi.spyOn(page.conn, "connected", "get").mockReturnValue(false);
    ready.resolve(8);
    await checked;
    expect(installations()).toHaveLength(0);
  });

  it("preserves session closure for an unlimited wait without retrying", async () => {
    const closed = new Error("CDP connection closed: socket-close");
    send.mockImplementation((method, params) =>
      params?.awaitPromise ? Promise.reject(closed) : respond(method),
    );
    await expect(page.waitForFunction("false", { timeout: 0 })).rejects.toBe(closed);
    expect(installations()).toHaveLength(1);
    expect(disposals()).toHaveLength(1);
    expect(send).toHaveBeenCalledWith("Runtime.releaseObject", {
      objectId: "wait-handle",
    });
  });

  it.each([false, true])(
    "disposes a late installation (deadline timer fired=%s)",
    async (timerFired) => {
      const installation = deferred<unknown>();
      send.mockImplementation((method) =>
        method === "Runtime.evaluate" ? installation.promise : respond(method),
      );
      const checked = expect(page.waitForFunction("true", { timeout: 100 })).rejects.toThrow(
        TimeoutError,
      );
      await vi.advanceTimersByTimeAsync(timerFired ? 100 : 0);
      if (!timerFired) vi.spyOn(performance, "now").mockReturnValue(100);
      installation.resolve({ result: { objectId: "late-handle" } });
      await checked;
      await vi.advanceTimersByTimeAsync(0);
      expect(disposals()).toHaveLength(1);
      expect(disposals()[0][1]).toMatchObject({ objectId: "late-handle" });
      expect(send).toHaveBeenCalledWith("Runtime.releaseObject", {
        objectId: "late-handle",
      });
      expect(send.mock.calls.some(([, params]) => params?.awaitPromise)).toBe(false);
    },
  );

  it.each(["installation", "waiting"])("preserves browser exceptions during %s", async (phase) => {
    send.mockImplementation((method, params) => {
      if (
        (phase === "installation" && method === "Runtime.evaluate") ||
        (phase === "waiting" && params?.awaitPromise)
      ) {
        return Promise.resolve({
          result: {},
          exceptionDetails: {
            exception: { description: "Error: predicate failed" },
          },
        });
      }
      return respond(method);
    });
    await expect(page.waitForFunction("throwError()")).rejects.toThrow("predicate failed");
    expect(installations()).toHaveLength(1);
    expect(disposals()).toHaveLength(phase === "waiting" ? 1 : 0);
  });

  it.each(["reject", "stall"])("preserves timeout if cleanup commands %s", async (failure) => {
    const result = deferred<unknown>();
    const cleanup = deferred<unknown>();
    send.mockImplementation((method, params) => {
      if (params?.awaitPromise) return result.promise;
      if (method === "Runtime.callFunctionOn" || method === "Runtime.releaseObject") {
        return failure === "stall"
          ? cleanup.promise
          : Promise.reject(new Error("context destroyed"));
      }
      return respond(method);
    });
    const checked = expect(page.waitForFunction("false", { timeout: 100 })).rejects.toThrow(
      TimeoutError,
    );
    await vi.advanceTimersByTimeAsync(100);
    await checked;
    expect(disposals()).toHaveLength(1);
    expect(send).toHaveBeenCalledWith("Runtime.releaseObject", {
      objectId: "wait-handle",
    });
    await vi.advanceTimersByTimeAsync(1000);
    result.resolve({ result: { value: true } });
    cleanup.resolve({});
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFunctionWait } from "../understudy/functionWait.js";

describe("injected waitForFunction", () => {
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.set(++nextFrame, callback);
      return nextFrame;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  });

  afterEach(() => {
    expect(vi.getTimerCount()).toBe(0);
    expect(frames.size).toBe(0);
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each([true, "ready", 42, { ready: true }, ["ready"]])(
    "returns the first truthy JSON value: %j",
    async (value) => {
      const predicate = vi.fn(() => value);
      const wait = createFunctionWait(predicate, "raf");
      await expect(wait.promise).resolves.toEqual(value);
      wait.dispose();
      expect(predicate).toHaveBeenCalledOnce();
    },
  );

  it("checks immediately, then on browser animation frames", async () => {
    const predicate = vi.fn().mockReturnValueOnce(false).mockReturnValue("ready");
    const wait = createFunctionWait(predicate, "raf");
    expect(predicate).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(0);
    expect(frames.size).toBe(1);
    const [id, callback] = [...frames][0];
    frames.delete(id);
    callback(16);
    await expect(wait.promise).resolves.toBe("ready");
    expect(predicate).toHaveBeenCalledTimes(2);
  });

  it("polls falsy values at the requested interval", async () => {
    const predicate = vi
      .fn()
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce(null)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce("")
      .mockReturnValue("ready");
    const wait = createFunctionWait(predicate, 25);
    await vi.advanceTimersByTimeAsync(99);
    expect(predicate).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(1);
    await expect(wait.promise).resolves.toBe("ready");
    expect(predicate).toHaveBeenCalledTimes(5);
  });

  it("never overlaps asynchronous predicate calls", async () => {
    let finish!: (value: boolean) => void;
    const first = new Promise<boolean>((resolve) => {
      finish = resolve;
    });
    const predicate = vi.fn().mockReturnValueOnce(first).mockResolvedValue("ready");
    const wait = createFunctionWait(predicate, 10);
    await vi.advanceTimersByTimeAsync(100);
    expect(predicate).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    finish(false);
    await vi.advanceTimersByTimeAsync(9);
    expect(predicate).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    await expect(wait.promise).resolves.toBe("ready");
  });

  it.each(["synchronous", "asynchronous"])("preserves %s predicate failures", async (kind) => {
    const error = new Error("predicate failed");
    const wait = createFunctionWait(() => {
      if (kind === "asynchronous") return Promise.reject(error);
      throw error;
    }, 10);
    await expect(wait.promise).rejects.toBe(error);
    wait.dispose();
  });

  it.each(["raf", 10] as const)("cancels pending %s polling on disposal", async (polling) => {
    const predicate = vi.fn(() => false);
    const wait = createFunctionWait(predicate, polling);
    await vi.advanceTimersByTimeAsync(0);
    wait.dispose();
    await expect(wait.promise).rejects.toThrow("disposed");
    wait.dispose();
    await vi.advanceTimersByTimeAsync(100);
    expect(predicate).toHaveBeenCalledOnce();
  });

  it.each([false, true])(
    "does not restart after a disposed predicate resolves to %s",
    async (value) => {
      let finish!: (result: boolean) => void;
      const predicate = vi.fn(
        () =>
          new Promise<boolean>((resolve) => {
            finish = resolve;
          }),
      );
      const wait = createFunctionWait(predicate, 10);
      wait.dispose();
      await expect(wait.promise).rejects.toThrow("disposed");
      finish(value);
      await vi.advanceTimersByTimeAsync(100);
      expect(predicate).toHaveBeenCalledOnce();
    },
  );

  it("observes a rejected predicate after disposal", async () => {
    let fail!: (error: Error) => void;
    const wait = createFunctionWait(
      () =>
        new Promise((_, reject) => {
          fail = reject;
        }),
      "raf",
    );
    wait.dispose();
    await expect(wait.promise).rejects.toThrow("disposed");
    fail(new Error("late rejection"));
    await vi.advanceTimersByTimeAsync(0);
  });

  it("invokes an expression that evaluates to a function", async () => {
    let calls = 0;
    const wait = createFunctionWait(() => async () => ++calls >= 2 && { calls }, 10);
    await vi.advanceTimersByTimeAsync(10);
    await expect(wait.promise).resolves.toEqual({ calls: 2 });
  });

  // The function case returns a function after invocation, which is still not JSON.
  it.each([() => () => {}, Symbol("ready"), 1n])(
    "rejects non-JSON values without leaving a polling task",
    async (value) => {
      const wait = createFunctionWait(() => value, 10);
      await expect(wait.promise).rejects.toThrow();
    },
  );

  it("rejects circular results", async () => {
    const value: { self?: object } = {};
    value.self = value;
    const wait = createFunctionWait(() => value, "raf");
    await expect(wait.promise).rejects.toThrow();
  });
});

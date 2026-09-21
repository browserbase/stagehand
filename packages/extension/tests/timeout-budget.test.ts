import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TimeoutError } from "../errors.js";
import { TimeoutBudget } from "../timeoutBudget.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("TimeoutBudget", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date", "performance"] });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.each([undefined, 0])(
    "treats %s as no deadline without scheduling a timer",
    async (timeout) => {
      const budget = new TimeoutBudget(timeout);
      const work = deferred<string>();
      const result = budget.run(() => work.promise);
      await vi.advanceTimersByTimeAsync(100_000);

      expect(budget.remainingMs()).toBeUndefined();
      expect(budget.deadline).toBeUndefined();
      expect(vi.getTimerCount()).toBe(0);
      expect(() => budget.throwIfExpired()).not.toThrow();
      work.resolve("done");
      await expect(result).resolves.toBe("done");
    },
  );

  it.each([-1, NaN, Infinity, -Infinity])("rejects invalid timeout %s", (timeout) => {
    expect(() => new TimeoutBudget(timeout)).toThrow(RangeError);
  });

  it("uses monotonic elapsed time despite wall-clock changes", async () => {
    const budget = new TimeoutBudget(1_000);
    await vi.advanceTimersByTimeAsync(250);
    vi.setSystemTime(new Date("2040-01-01"));
    expect(budget.remainingMs()).toBe(750);
    vi.setSystemTime(new Date("2000-01-01"));
    expect(budget.remainingMs()).toBe(750);
    await vi.advanceTimersByTimeAsync(750);
    expect(budget.remainingMs()).toBe(0);
    expect(() => budget.throwIfExpired()).toThrow(TimeoutError);
  });

  it("does not start a new stage after its finite budget expires", async () => {
    const budget = new TimeoutBudget(100);
    await vi.advanceTimersByTimeAsync(100);
    const task = vi.fn();
    await expect(budget.run(task)).rejects.toThrow("operation timed out after 100ms");
    expect(task).not.toHaveBeenCalled();
    expect(budget.remainingMs()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("shares remaining time across sequential stages and aborts pending work", async () => {
    const budget = new TimeoutBudget(1_000);
    const first = budget.run(() => new Promise<void>((resolve) => setTimeout(resolve, 600)));
    await vi.advanceTimersByTimeAsync(600);
    await first;
    expect(budget.remainingMs()).toBe(400);

    const cleanup = vi.fn();
    let signal!: AbortSignal;
    const second = budget.run((stageSignal) => {
      signal = stageSignal;
      signal.addEventListener("abort", cleanup, { once: true });
      return new Promise<void>(() => {});
    });
    const rejected = expect(second).rejects.toThrow("operation timed out after 1000ms");
    await vi.advanceTimersByTimeAsync(399);
    expect(signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await rejected;
    expect(signal.aborted).toBe(true);
    expect(signal.reason).toBeInstanceOf(TimeoutError);
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps independent concurrent budgets isolated", async () => {
    const short = new TimeoutBudget(100);
    const long = new TimeoutBudget(1_000);
    const work = deferred<string>();
    const shortResult = short.run(() => work.promise);
    const longResult = long.run(() => work.promise);
    const rejected = expect(shortResult).rejects.toThrow(TimeoutError);
    await vi.advanceTimersByTimeAsync(100);
    await rejected;
    expect(long.remainingMs()).toBe(900);
    work.resolve("ready");
    await expect(longResult).resolves.toBe("ready");
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["resolve", "reject"] as const)(
    "safely handles late %s after timeout",
    async (settle) => {
      const budget = new TimeoutBudget(100);
      const work = deferred<string>();
      const onSuccess = vi.fn();
      const result = budget.run(() => work.promise).then(onSuccess);
      const rejected = expect(result).rejects.toThrow(TimeoutError);
      await vi.advanceTimersByTimeAsync(100);
      await rejected;
      if (settle === "resolve") work.resolve("too late");
      else work.reject(new Error("late failure"));
      await vi.advanceTimersByTimeAsync(0);
      expect(onSuccess).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("clears timers on success and preserves errors before expiry", async () => {
    const budget = new TimeoutBudget(100);
    await expect(budget.run(() => "ready")).resolves.toBe("ready");
    expect(vi.getTimerCount()).toBe(0);
    const failure = new Error("invalid selector");
    await expect(budget.run(() => Promise.reject(failure))).rejects.toBe(failure);
    expect(vi.getTimerCount()).toBe(0);
    await expect(
      budget.run(() => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects late completion even before the timeout timer gets a turn", async () => {
    const now = vi.spyOn(performance, "now").mockReturnValue(0);
    const budget = new TimeoutBudget(100);
    let signal!: AbortSignal;
    await expect(
      budget.run((stageSignal) => {
        signal = stageSignal;
        now.mockReturnValue(101);
        return "too late";
      }),
    ).rejects.toThrow(TimeoutError);
    expect(signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("uses the caller's error factory consistently", async () => {
    const error = new TimeoutError("locator.click", 100);
    const factory = vi.fn(() => error);
    const budget = new TimeoutBudget(100, factory);
    const result = budget.run(() => new Promise<void>(() => {}));
    const rejected = expect(result).rejects.toBe(error);
    await vi.advanceTimersByTimeAsync(100);
    await rejected;
    expect(() => budget.throwIfExpired()).toThrow(error);
    expect(factory).toHaveBeenCalledExactlyOnceWith(100);
  });

  it("does not overflow timers for large finite budgets", async () => {
    const budget = new TimeoutBudget(2_147_483_647 + 100);
    const work = deferred<string>();
    const result = budget.run(() => work.promise);
    await vi.advanceTimersByTimeAsync(2_147_483_647);
    expect(budget.remainingMs()).toBe(100);
    work.resolve("ready");
    await expect(result).resolves.toBe("ready");
    expect(vi.getTimerCount()).toBe(0);
  });
});

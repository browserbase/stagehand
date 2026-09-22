import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TimeoutError } from "../errors.js";
import { LocatorOperation, runLocatorOperation } from "./locatorOperation.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("locator operation deadlines", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance", "Date"] });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("uses elapsed monotonic time, independent of changes to the wall clock", async () => {
    await runLocatorOperation({ name: "locator.click", timeout: 100 }, async (operation) => {
      expect(operation.remainingMs()).toBe(100);
      vi.setSystemTime(Date.now() + 60_000);
      expect(operation.remainingMs()).toBe(100);
      await vi.advanceTimersByTimeAsync(40);
      expect(operation.remainingMs()).toBe(60);
      expect(operation.signal.aborted).toBe(false);
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects at the deadline and keeps the same timeout reason", async () => {
    const gate = deferred<void>();
    let operation!: LocatorOperation;
    const result = runLocatorOperation({ name: "locator.click", timeout: 100 }, async (context) => {
      operation = context;
      await gate.promise;
    });
    const rejected = expect(result).rejects.toThrow("locator.click timed out after 100ms");

    await vi.advanceTimersByTimeAsync(100);
    await rejected;
    expect(operation.remainingMs()).toBe(0);
    expect(operation.signal.reason).toBeInstanceOf(TimeoutError);
    expect(() => operation.throwIfStopped()).toThrow(operation.signal.reason);
    expect(vi.getTimerCount()).toBe(0);
    gate.resolve();
  });

  it("checks expiry even before the deadline timer gets a turn", async () => {
    await expect(
      runLocatorOperation({ name: "locator.click", timeout: 100 }, async (operation) => {
        vi.spyOn(performance, "now").mockReturnValue(101);
        expect(() => operation.throwIfStopped()).toThrow(TimeoutError);
        expect(operation.signal.aborted).toBe(true);
      }),
    ).rejects.toThrow(TimeoutError);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not return success when work finishes after its deadline", async () => {
    await expect(
      runLocatorOperation({ name: "locator.click", timeout: 100 }, async () => {
        vi.spyOn(performance, "now").mockReturnValue(101);
        return "too late";
      }),
    ).rejects.toThrow(TimeoutError);
  });

  it("runs without a deadline or timer when timeout is zero", async () => {
    const gate = deferred<string>();
    let operation!: LocatorOperation;
    const result = runLocatorOperation({ name: "locator.type", timeout: 0 }, async (context) => {
      operation = context;
      return gate.promise;
    });
    await Promise.resolve();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(1_000_000);
    expect(operation.remainingMs()).toBe(Infinity);
    expect(operation.signal.aborted).toBe(false);
    expect(() => operation.throwIfStopped()).not.toThrow();
    gate.resolve("done");
    await expect(result).resolves.toBe("done");
  });

  it("reuses the parent context and leaves its timer running after nested work", async () => {
    const gate = deferred<void>();
    const result = runLocatorOperation({ name: "locator.fill", timeout: 100 }, async (parent) => {
      await vi.advanceTimersByTimeAsync(60);
      await runLocatorOperation(parent, async (child) => {
        expect(child).toBe(parent);
        expect(child.remainingMs()).toBe(40);
        expect(vi.getTimerCount()).toBe(1);
      });
      expect(vi.getTimerCount()).toBe(1);
      await gate.promise;
    });
    const rejected = expect(result).rejects.toThrow("locator.fill timed out after 100ms");

    // Let the nested call complete before advancing the parent's remaining budget.
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(40);
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
    gate.resolve();
  });

  it("does not let a failed nested call dispose the parent's deadline", async () => {
    const gate = deferred<void>();
    const error = new Error("nested lookup failed");
    const result = runLocatorOperation({ name: "locator.fill", timeout: 100 }, async (parent) => {
      await expect(
        runLocatorOperation(parent, async () => {
          throw error;
        }),
      ).rejects.toBe(error);
      expect(vi.getTimerCount()).toBe(1);
      await gate.promise;
    });
    const rejected = expect(result).rejects.toThrow(TimeoutError);

    await vi.advanceTimersByTimeAsync(100);
    await rejected;
    gate.resolve();
  });

  it("does not invoke nested work after the parent expires", async () => {
    const gate = deferred<void>();
    let operation!: LocatorOperation;
    const result = runLocatorOperation({ name: "locator.fill", timeout: 100 }, async (context) => {
      operation = context;
      return gate.promise;
    });
    const rejected = expect(result).rejects.toThrow(TimeoutError);
    await vi.advanceTimersByTimeAsync(100);
    await rejected;

    const work = vi.fn(async () => {});
    await expect(runLocatorOperation(operation, work)).rejects.toBe(operation.signal.reason);
    expect(work).not.toHaveBeenCalled();
    gate.resolve();
  });

  it("keeps concurrent operations independent", async () => {
    const firstGate = deferred<void>();
    const secondGate = deferred<string>();
    let second!: LocatorOperation;
    const first = runLocatorOperation(
      { name: "locator.click", timeout: 10 },
      () => firstGate.promise,
    );
    const other = runLocatorOperation({ name: "locator.click", timeout: 100 }, async (context) => {
      second = context;
      return secondGate.promise;
    });
    const rejected = expect(first).rejects.toThrow(TimeoutError);

    await vi.advanceTimersByTimeAsync(10);
    await rejected;
    expect(second.signal.aborted).toBe(false);
    expect(second.remainingMs()).toBe(90);
    secondGate.resolve("done");
    await expect(other).resolves.toBe("done");
    expect(vi.getTimerCount()).toBe(0);
    firstGate.resolve();
  });

  it.each(["success", "failure", "synchronous failure"] as const)(
    "disposes the timer and abort listener on %s",
    async (outcome) => {
      const error = new Error("action failed");
      let signal!: AbortSignal;
      let removeListener!: ReturnType<typeof vi.spyOn>;
      const result = runLocatorOperation({ name: "locator.click", timeout: 100 }, (operation) => {
        signal = operation.signal;
        removeListener = vi.spyOn(signal, "removeEventListener");
        if (outcome === "synchronous failure") throw error;
        return outcome === "success" ? Promise.resolve("done") : Promise.reject(error);
      });

      if (outcome === "success") await expect(result).resolves.toBe("done");
      else await expect(result).rejects.toBe(error);

      expect(removeListener).toHaveBeenCalledWith("abort", expect.any(Function));
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(100);
      expect(signal.aborted).toBe(false);
    },
  );

  it("does not truncate timeouts larger than one timer interval", async () => {
    const maxTimerMs = 2_147_483_647;
    const gate = deferred<void>();
    let operation!: LocatorOperation;
    const result = runLocatorOperation(
      { name: "locator.type", timeout: maxTimerMs + 100 },
      async (context) => {
        operation = context;
        return gate.promise;
      },
    );
    const rejected = expect(result).rejects.toThrow(TimeoutError);

    await vi.advanceTimersByTimeAsync(maxTimerMs);
    expect(operation.signal.aborted).toBe(false);
    expect(operation.remainingMs()).toBe(100);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(100);
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
    gate.resolve();
  });

  it.each([-1, NaN, Infinity, -Infinity])(
    "rejects invalid timeout %s before starting work",
    async (timeout) => {
      const work = vi.fn(async () => {});
      await expect(runLocatorOperation({ name: "locator.click", timeout }, work)).rejects.toThrow(
        RangeError,
      );
      expect(work).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    },
  );
});

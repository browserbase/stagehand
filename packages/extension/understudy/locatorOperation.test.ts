import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TimeoutError } from "../errors.js";
import { LocatorOperation, runLocatorOperation } from "./locatorOperation.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("locator operations", () => {
  const operations: LocatorOperation[] = [];
  function createOperation(timeout = 100) {
    const operation = new LocatorOperation("locator.click", timeout);
    operations.push(operation);
    return operation;
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance", "Date"] });
  });

  afterEach(() => {
    operations.splice(0).forEach((operation) => operation.dispose());
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.each([0, 100])(
    "tracks a %s ms budget independently of wall-clock changes",
    async (timeout) => {
      const operation = createOperation(timeout);
      vi.setSystemTime(Date.now() + 60_000);
      expect(operation.remainingMs()).toBe(timeout || Infinity);
      await vi.advanceTimersByTimeAsync(40);
      expect(operation.remainingMs()).toBe(timeout ? 60 : Infinity);
      expect(operation.signal.aborted).toBe(false);
      expect(vi.getTimerCount()).toBe(timeout ? 1 : 0);
    },
  );

  it.each(["success", "failure"] as const)(
    "reuses the parent's remaining budget after nested %s",
    async (outcome) => {
      const operation = createOperation();
      const error = new Error("nested failure");
      await vi.advanceTimersByTimeAsync(60);
      const nested = runLocatorOperation(operation, async (child) => {
        expect(child).toBe(operation);
        expect(child.remainingMs()).toBe(40);
        if (outcome === "failure") throw error;
      });
      if (outcome === "failure") await expect(nested).rejects.toBe(error);
      else await nested;

      expect(vi.getTimerCount()).toBe(1);
      await vi.advanceTimersByTimeAsync(40);
      expect(operation.remainingMs()).toBe(0);
      expect(operation.signal.reason).toBeInstanceOf(TimeoutError);
      expect(() => operation.throwIfStopped()).toThrow(operation.signal.reason);
    },
  );

  it("keeps concurrent operations independent", async () => {
    const short = createOperation(10);
    const long = createOperation(100);
    const gate = deferred<string>();
    const first = expect(short.run("reading", () => gate.promise)).rejects.toThrow(TimeoutError);
    const second = long.run("reading", () => gate.promise);
    await vi.advanceTimersByTimeAsync(10);
    await first;
    expect(long.signal.aborted).toBe(false);
    expect(long.remainingMs()).toBe(90);
    gate.resolve("done");
    await expect(second).resolves.toBe("done");
  });

  it.each(["success", "failure", "synchronous failure", "timeout"] as const)(
    "disposes the owning runner's timer and listener on %s",
    async (outcome) => {
      const gate = deferred<string>();
      const error = new Error("action failed");
      let signal!: AbortSignal;
      let remove!: ReturnType<typeof vi.spyOn>;
      const pending = runLocatorOperation({ name: "locator.click", timeout: 100 }, (operation) => {
        signal = operation.signal;
        remove = vi.spyOn(signal, "removeEventListener");
        if (outcome === "synchronous failure") throw error;
        return gate.promise;
      });
      await Promise.resolve();
      if (outcome === "success") {
        gate.resolve("done");
        await expect(pending).resolves.toBe("done");
      } else if (outcome === "timeout") {
        const rejected = expect(pending).rejects.toThrow(TimeoutError);
        await vi.advanceTimersByTimeAsync(100);
        await rejected;
        gate.resolve("late");
      } else {
        const rejected = expect(pending).rejects.toBe(error);
        if (outcome === "failure") gate.reject(error);
        await rejected;
      }
      expect(remove).toHaveBeenCalledExactlyOnceWith("abort", expect.any(Function));
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(100);
      expect(signal.aborted).toBe(outcome === "timeout");
    },
  );

  it("checks expiry before dispatch, even before the deadline timer runs", async () => {
    const operation = createOperation();
    const command = vi.fn(async () => {});
    const pending = operation.run("clicking", command);
    vi.spyOn(performance, "now").mockReturnValue(101);
    await expect(pending).rejects.toThrow(TimeoutError);
    await expect(runLocatorOperation(operation, command)).rejects.toBe(operation.signal.reason);
    expect(command).not.toHaveBeenCalled();
  });

  it.each(["throws", "rejects"] as const)(
    "reports timeout when work %s after the deadline before the timer runs",
    async (failure) => {
      const operation = createOperation();
      const pending = operation.run("reading geometry", () => {
        vi.spyOn(performance, "now").mockReturnValue(101);
        expect(operation.signal.aborted).toBe(false);
        const error = new Error("browser error");
        if (failure === "throws") throw error;
        return Promise.reject(error);
      });
      await expect(pending).rejects.toThrow(
        "locator.click timed out after 100ms while reading geometry",
      );
      expect(operation.signal.reason).toBeInstanceOf(TimeoutError);
    },
  );

  it("delivers a successful resource without invoking late cleanup", async () => {
    const operation = createOperation();
    const release = vi.fn(async () => {});
    await expect(operation.run("finding node", async () => "node", release)).resolves.toBe("node");
    expect(release).not.toHaveBeenCalled();
  });

  it.each(["resolves", "rejects"] as const)(
    "does not resume timed-out work when a late command %s",
    async (outcome) => {
      const operation = createOperation();
      const command = deferred<string>();
      const nextStep = vi.fn(async () => {});
      const release = vi.fn(async () => {});
      const remove = vi.spyOn(operation.signal, "removeEventListener");
      await vi.advanceTimersByTimeAsync(60);
      const pending = runLocatorOperation(operation, async (context) => {
        await context.run("finding node", () => command.promise, release);
        await context.run("clicking", nextStep);
      });
      const rejected = expect(pending).rejects.toThrow(
        "locator.click timed out after 100ms while finding node",
      );
      // A finished concurrent phase must not replace the phase that is still waiting.
      await operation.run("inspecting another frame", async () => {});
      await vi.advanceTimersByTimeAsync(40);
      await rejected;
      expect(remove).toHaveBeenCalledTimes(3);
      if (outcome === "resolves") command.resolve("late-node");
      else command.reject(new Error("late browser error"));
      await vi.advanceTimersByTimeAsync(0);
      expect(nextStep).not.toHaveBeenCalled();
      if (outcome === "resolves") expect(release).toHaveBeenCalledExactlyOnceWith("late-node");
      else expect(release).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("releases a result that crosses the deadline before delivery", async () => {
    const operation = createOperation();
    const release = vi.fn(async () => {});
    const pending = operation.run(
      "finding node",
      async () => {
        vi.spyOn(performance, "now").mockReturnValue(101);
        return "node";
      },
      release,
    );
    await expect(pending).rejects.toThrow(TimeoutError);
    expect(release).toHaveBeenCalledExactlyOnceWith("node");
  });

  it.each([0, 25, 1_000])("bounds a %s ms delay and removes its sleep timer", async (ms) => {
    const operation = createOperation();
    const pending = operation.delay(ms);
    if (ms > 100) {
      const rejected = expect(pending).rejects.toThrow(TimeoutError);
      await vi.advanceTimersByTimeAsync(100);
      await rejected;
      expect(vi.getTimerCount()).toBe(0);
    } else {
      await vi.advanceTimersByTimeAsync(ms);
      await pending;
      expect(operation.remainingMs()).toBe(100 - ms);
      expect(operation.signal.aborted).toBe(false);
      expect(vi.getTimerCount()).toBe(1);
    }
  });

  it.each(["deadline", "unlimited delay"] as const)(
    "does not truncate a long %s to one timer interval",
    async (kind) => {
      const maxTimerMs = 2_147_483_647;
      const gate = deferred<void>();
      const operation = createOperation(kind === "deadline" ? maxTimerMs + 100 : 0);
      const pending =
        kind === "deadline"
          ? operation.run("waiting", () => gate.promise)
          : operation.delay(maxTimerMs + 100);
      const result =
        kind === "deadline"
          ? expect(pending).rejects.toThrow(TimeoutError)
          : expect(pending).resolves.toBeUndefined();
      await vi.advanceTimersByTimeAsync(maxTimerMs);
      expect(operation.signal.aborted).toBe(false);
      expect(vi.getTimerCount()).toBe(1);
      expect(operation.remainingMs()).toBe(kind === "deadline" ? 100 : Infinity);
      await vi.advanceTimersByTimeAsync(100);
      await result;
      expect(vi.getTimerCount()).toBe(0);
      gate.resolve();
    },
  );

  it.each([-1, NaN, Infinity, -Infinity])("rejects invalid time values: %s", async (timeout) => {
    const command = vi.fn(async () => {});
    await expect(runLocatorOperation({ name: "locator.click", timeout }, command)).rejects.toThrow(
      RangeError,
    );
    await expect(createOperation().delay(timeout)).rejects.toThrow(RangeError);
    expect(command).not.toHaveBeenCalled();
  });

  it.each(["success", "failure", "synchronous failure"] as const)(
    "preserves the primary error and clears the cleanup timer after cleanup %s",
    async (outcome) => {
      const operation = createOperation();
      const error = new Error("element detached");
      await expect(
        runLocatorOperation(operation, async (context) => {
          try {
            throw error;
          } finally {
            await context.cleanup(() => {
              if (outcome === "synchronous failure") throw new Error("release failed");
              return outcome === "success"
                ? Promise.resolve()
                : Promise.reject(new Error("release failed"));
            });
          }
        }),
      ).rejects.toBe(error);
      expect(vi.getTimerCount()).toBe(1);
    },
  );

  it("returns on timeout while bounding cleanup and observing its late rejection", async () => {
    const operation = createOperation();
    const command = deferred<void>();
    const release = deferred<void>();
    const cleanup = vi.fn(() => release.promise);
    let cleanedUp = false;
    const pending = runLocatorOperation(operation, async (context) => {
      try {
        await context.run("finding node", () => command.promise);
      } finally {
        await context.cleanup(cleanup);
        cleanedUp = true;
      }
    });
    const rejected = expect(pending).rejects.toThrow(TimeoutError);
    await vi.advanceTimersByTimeAsync(100);
    await rejected;
    expect(cleanup).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(999);
    expect(cleanedUp).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(cleanedUp).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    release.reject(new Error("late cleanup failure"));
    command.resolve();
    await vi.advanceTimersByTimeAsync(0);
  });
});

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

describe("locator operation steps", () => {
  let operation: LocatorOperation;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    operation = new LocatorOperation("locator.click", 100);
  });

  afterEach(() => {
    operation.dispose();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("does not dispatch work after expiry, even before the timer runs", async () => {
    const command = vi.fn(async () => {});
    const pending = operation.run("clicking", command);
    const rejected = expect(pending).rejects.toThrow(TimeoutError);

    // Expire between accepting the callback and actually invoking it.
    vi.spyOn(performance, "now").mockReturnValue(101);
    await rejected;
    expect(command).not.toHaveBeenCalled();
  });

  it("uses the remaining budget and does not resume after a late response", async () => {
    const command = deferred<void>();
    const nextStep = vi.fn(async () => {});
    await vi.advanceTimersByTimeAsync(60);
    const pending = runLocatorOperation(operation, async (context) => {
      await context.run("reading geometry", () => command.promise);
      await context.run("clicking", nextStep);
    });
    const rejected = expect(pending).rejects.toThrow(
      "locator.click timed out after 100ms while reading geometry",
    );

    await vi.advanceTimersByTimeAsync(40);
    await rejected;
    command.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(nextStep).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("delivers successful results without releasing the caller's resource", async () => {
    const handle = { objectId: "node" };
    const release = vi.fn(async () => {});
    await expect(operation.run("finding node", async () => handle, release)).resolves.toBe(handle);
    expect(release).not.toHaveBeenCalled();
  });

  it("releases a late resource exactly once after timeout", async () => {
    const command = deferred<{ objectId: string }>();
    const handle = { objectId: "late-node" };
    const release = vi.fn(async () => {});
    const pending = operation.run("finding node", () => command.promise, release);
    const rejected = expect(pending).rejects.toThrow(TimeoutError);

    await vi.advanceTimersByTimeAsync(100);
    await rejected;
    expect(release).not.toHaveBeenCalled();
    command.resolve(handle);
    await vi.advanceTimersByTimeAsync(0);
    expect(release).toHaveBeenCalledExactlyOnceWith(handle);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("releases an undelivered result when work crosses the deadline before the timer runs", async () => {
    const handle = { objectId: "node" };
    const release = vi.fn(async () => {});
    const pending = operation.run(
      "finding node",
      async () => {
        vi.spyOn(performance, "now").mockReturnValue(101);
        return handle;
      },
      release,
    );

    await expect(pending).rejects.toThrow(TimeoutError);
    expect(release).toHaveBeenCalledExactlyOnceWith(handle);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("handles a command rejection arriving after timeout", async () => {
    const command = deferred<void>();
    const release = vi.fn(async () => {});
    const pending = operation.run("finding node", () => command.promise, release);
    const rejected = expect(pending).rejects.toThrow(TimeoutError);

    await vi.advanceTimersByTimeAsync(100);
    await rejected;
    command.reject(new Error("late browser error"));
    await vi.advanceTimersByTimeAsync(0);
    expect(release).not.toHaveBeenCalled();
    expect(operation.signal.reason).toBeInstanceOf(TimeoutError);
  });

  it.each(["success", "failure", "synchronous failure", "timeout"] as const)(
    "removes the step's abort listener on %s",
    async (outcome) => {
      const add = vi.spyOn(operation.signal, "addEventListener");
      const remove = vi.spyOn(operation.signal, "removeEventListener");
      const command = deferred<string>();
      const error = new Error("browser error");
      const pending = operation.run("reading geometry", () => {
        if (outcome === "synchronous failure") throw error;
        return command.promise;
      });

      if (outcome === "success") {
        command.resolve("done");
        await expect(pending).resolves.toBe("done");
      } else if (outcome === "timeout") {
        const rejected = expect(pending).rejects.toThrow(TimeoutError);
        await vi.advanceTimersByTimeAsync(100);
        await rejected;
        command.resolve("too late");
      } else {
        const rejected = expect(pending).rejects.toBe(error);
        if (outcome === "failure") {
          await Promise.resolve();
          command.reject(error);
        }
        await rejected;
      }

      expect(add).toHaveBeenCalledOnce();
      expect(remove).toHaveBeenCalledExactlyOnceWith("abort", add.mock.calls[0]![1]);
    },
  );

  it("reports a pending phase rather than a concurrent phase that already finished", async () => {
    const command = deferred<void>();
    const pending = operation.run("waiting for frame", () => command.promise);
    const rejected = expect(pending).rejects.toThrow(
      "locator.click timed out after 100ms while waiting for frame",
    );
    await operation.run("inspecting another frame", async () => {});
    await vi.advanceTimersByTimeAsync(100);
    await rejected;
    command.resolve();
  });

  it("interrupts a delay and clears its timer", async () => {
    const pending = operation.delay(1_000);
    const rejected = expect(pending).rejects.toThrow(TimeoutError);
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(2);

    await vi.advanceTimersByTimeAsync(100);
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears a completed delay's timer without stopping the operation", async () => {
    const pending = operation.delay(25);
    await vi.advanceTimersByTimeAsync(25);
    await pending;
    expect(operation.remainingMs()).toBe(75);
    expect(operation.signal.aborted).toBe(false);
    expect(vi.getTimerCount()).toBe(1);
  });

  it("supports zero delay without allocating a sleep timer", async () => {
    await operation.delay(0);
    expect(operation.remainingMs()).toBe(100);
    expect(vi.getTimerCount()).toBe(1);
  });

  it("supports long delays when the operation has no deadline", async () => {
    operation.dispose();
    operation = new LocatorOperation("locator.type", 0);
    const maxTimerMs = 2_147_483_647;
    let finished = false;
    const pending = operation.delay(maxTimerMs + 100).then(() => {
      finished = true;
    });

    await vi.advanceTimersByTimeAsync(maxTimerMs);
    expect(finished).toBe(false);
    await vi.advanceTimersByTimeAsync(100);
    await pending;
    expect(finished).toBe(true);
    expect(operation.signal.aborted).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([-1, NaN, Infinity])("rejects invalid delay %s", async (ms) => {
    await expect(operation.delay(ms)).rejects.toThrow(RangeError);
    expect(vi.getTimerCount()).toBe(1);
  });

  it("attempts cleanup after expiry and bounds its wait even if the command stalls", async () => {
    await vi.advanceTimersByTimeAsync(100);
    const command = deferred<void>();
    const cleanup = vi.fn(() => command.promise);
    let finished = false;
    const pending = operation.cleanup(cleanup).then(() => {
      finished = true;
    });

    await vi.advanceTimersByTimeAsync(999);
    expect(cleanup).toHaveBeenCalledOnce();
    expect(finished).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(finished).toBe(true);
    expect(operation.signal.reason).toBeInstanceOf(TimeoutError);
    expect(vi.getTimerCount()).toBe(0);

    // A rejection after the cleanup wait ends must still be observed.
    command.reject(new Error("late cleanup failure"));
    await vi.advanceTimersByTimeAsync(0);
  });

  it.each(["success", "failure", "synchronous failure"] as const)(
    "clears the cleanup timer on %s",
    async (outcome) => {
      const error = new Error("cleanup failure");
      await operation.cleanup(() => {
        if (outcome === "synchronous failure") throw error;
        return outcome === "success" ? Promise.resolve() : Promise.reject(error);
      });
      expect(vi.getTimerCount()).toBe(1);
    },
  );

  it("preserves the primary error when cleanup fails", async () => {
    const error = new Error("element is detached");
    await expect(
      runLocatorOperation(operation, async (context) => {
        try {
          throw error;
        } finally {
          await context.cleanup(async () => {
            throw new Error("release failed");
          });
        }
      }),
    ).rejects.toBe(error);
  });

  it("does not hold the caller past timeout while finally cleanup is stalled", async () => {
    const command = deferred<void>();
    const release = deferred<void>();
    const cleanup = vi.fn(() => release.promise);
    const pending = runLocatorOperation(operation, async (context) => {
      try {
        await context.run("finding node", () => command.promise);
      } finally {
        await context.cleanup(cleanup);
      }
    });
    const rejected = expect(pending).rejects.toThrow(TimeoutError);

    await vi.advanceTimersByTimeAsync(100);
    await rejected;
    expect(cleanup).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(vi.getTimerCount()).toBe(0);
    command.resolve();
    release.resolve();
    await vi.advanceTimersByTimeAsync(0);
  });

  it.each(["synchronous failure", "failure", "stall"] as const)(
    "handles late resource cleanup ending in %s",
    async (outcome) => {
      const command = deferred<string>();
      const release = deferred<void>();
      const cleanup = vi.fn(() => {
        if (outcome === "synchronous failure") throw new Error("release failed");
        if (outcome === "failure") return Promise.reject(new Error("release failed"));
        return release.promise;
      });
      const pending = operation.run("finding node", () => command.promise, cleanup);
      const rejected = expect(pending).rejects.toThrow(TimeoutError);

      await vi.advanceTimersByTimeAsync(100);
      await rejected;
      command.resolve("late-node");
      await vi.advanceTimersByTimeAsync(1_000);
      expect(cleanup).toHaveBeenCalledExactlyOnceWith("late-node");
      expect(vi.getTimerCount()).toBe(0);
      release.resolve();
    },
  );
});

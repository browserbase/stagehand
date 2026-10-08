import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TimeoutError } from "../errors.js";
import { Progress, runWithProgress } from "./progress.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("progress", () => {
  const contexts: Progress[] = [];
  function createProgress(timeout = 100) {
    const progress = new Progress("locator.click", timeout);
    contexts.push(progress);
    return progress;
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance", "Date"] });
  });

  afterEach(() => {
    contexts.splice(0).forEach((progress) => progress.dispose());
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.each([0, 100])(
    "tracks a %s ms budget independently of wall-clock changes",
    async (timeout) => {
      const progress = createProgress(timeout);
      vi.setSystemTime(Date.now() + 60_000);
      expect(progress.remainingMs()).toBe(timeout || Infinity);
      await vi.advanceTimersByTimeAsync(40);
      expect(progress.remainingMs()).toBe(timeout ? 60 : Infinity);
      expect(progress.signal.aborted).toBe(false);
      expect(vi.getTimerCount()).toBe(timeout ? 1 : 0);
    },
  );

  it.each(["success", "failure"] as const)(
    "reuses the parent's remaining budget after nested %s",
    async (outcome) => {
      const progress = createProgress();
      const error = new Error("nested failure");
      await vi.advanceTimersByTimeAsync(60);
      const nested = runWithProgress(progress, async (child) => {
        expect(child).toBe(progress);
        expect(child.remainingMs()).toBe(40);
        if (outcome === "failure") throw error;
      });
      if (outcome === "failure") await expect(nested).rejects.toBe(error);
      else await nested;

      expect(vi.getTimerCount()).toBe(1);
      await vi.advanceTimersByTimeAsync(40);
      expect(progress.remainingMs()).toBe(0);
      expect(progress.signal.reason).toBeInstanceOf(TimeoutError);
      expect(() => progress.throwIfStopped()).toThrow(progress.signal.reason);
    },
  );

  it("keeps concurrent operations independent", async () => {
    const short = createProgress(10);
    const long = createProgress(100);
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
      const pending = runWithProgress({ name: "locator.click", timeout: 100 }, (progress) => {
        signal = progress.signal;
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
    const progress = createProgress();
    const command = vi.fn(async () => {});
    const pending = progress.run("clicking", command);
    vi.spyOn(performance, "now").mockReturnValue(101);
    await expect(pending).rejects.toThrow(TimeoutError);
    await expect(runWithProgress(progress, command)).rejects.toBe(progress.signal.reason);
    expect(command).not.toHaveBeenCalled();
  });

  it.each(["throws", "rejects"] as const)(
    "reports timeout when work %s after the deadline before the timer runs",
    async (failure) => {
      const progress = createProgress();
      const pending = progress.run("reading geometry", () => {
        vi.spyOn(performance, "now").mockReturnValue(101);
        expect(progress.signal.aborted).toBe(false);
        const error = new Error("browser error");
        if (failure === "throws") throw error;
        return Promise.reject(error);
      });
      await expect(pending).rejects.toThrow(
        "locator.click timed out after 100ms while reading geometry",
      );
      expect(progress.signal.reason).toBeInstanceOf(TimeoutError);
    },
  );

  it("delivers a successful resource without invoking late cleanup", async () => {
    const progress = createProgress();
    const release = vi.fn(async () => {});
    await expect(progress.run("finding node", async () => "node", release)).resolves.toBe("node");
    expect(release).not.toHaveBeenCalled();
  });

  it.each(["resolves", "rejects"] as const)(
    "does not resume timed-out work when a late command %s",
    async (outcome) => {
      const progress = createProgress();
      const command = deferred<string>();
      const nextStep = vi.fn(async () => {});
      const release = vi.fn(async () => {});
      const remove = vi.spyOn(progress.signal, "removeEventListener");
      await vi.advanceTimersByTimeAsync(60);
      const pending = runWithProgress(progress, async (context) => {
        await context.run("finding node", () => command.promise, release);
        await context.run("clicking", nextStep);
      });
      const rejected = expect(pending).rejects.toThrow(
        "locator.click timed out after 100ms while finding node",
      );
      // A finished concurrent phase must not replace the phase that is still waiting.
      await progress.run("inspecting another frame", async () => {});
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
    const progress = createProgress();
    const release = vi.fn(async () => {});
    const pending = progress.run(
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
    const progress = createProgress();
    const pending = progress.delay(ms);
    if (ms > 100) {
      const rejected = expect(pending).rejects.toThrow(TimeoutError);
      await vi.advanceTimersByTimeAsync(100);
      await rejected;
      expect(vi.getTimerCount()).toBe(0);
    } else {
      await vi.advanceTimersByTimeAsync(ms);
      await pending;
      expect(progress.remainingMs()).toBe(100 - ms);
      expect(progress.signal.aborted).toBe(false);
      expect(vi.getTimerCount()).toBe(1);
    }
  });

  it.each(["deadline", "unlimited delay"] as const)(
    "does not truncate a long %s to one timer interval",
    async (kind) => {
      const maxTimerMs = 2_147_483_647;
      const gate = deferred<void>();
      const progress = createProgress(kind === "deadline" ? maxTimerMs + 100 : 0);
      const pending =
        kind === "deadline"
          ? progress.run("waiting", () => gate.promise)
          : progress.delay(maxTimerMs + 100);
      const result =
        kind === "deadline"
          ? expect(pending).rejects.toThrow(TimeoutError)
          : expect(pending).resolves.toBeUndefined();
      await vi.advanceTimersByTimeAsync(maxTimerMs);
      expect(progress.signal.aborted).toBe(false);
      expect(vi.getTimerCount()).toBe(1);
      expect(progress.remainingMs()).toBe(kind === "deadline" ? 100 : Infinity);
      await vi.advanceTimersByTimeAsync(100);
      await result;
      expect(vi.getTimerCount()).toBe(0);
      gate.resolve();
    },
  );

  it.each([-1, NaN, Infinity, -Infinity])("rejects invalid time values: %s", async (timeout) => {
    const command = vi.fn(async () => {});
    await expect(runWithProgress({ name: "locator.click", timeout }, command)).rejects.toThrow(
      RangeError,
    );
    await expect(createProgress().delay(timeout)).rejects.toThrow(RangeError);
    expect(command).not.toHaveBeenCalled();
  });

  it.each(["success", "failure", "synchronous failure"] as const)(
    "preserves the primary error and clears the cleanup timer after cleanup %s",
    async (outcome) => {
      const progress = createProgress();
      const error = new Error("element detached");
      await expect(
        runWithProgress(progress, async (context) => {
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
    const progress = createProgress();
    const command = deferred<void>();
    const release = deferred<void>();
    const cleanup = vi.fn(() => release.promise);
    let cleanedUp = false;
    const pending = runWithProgress(progress, async (context) => {
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

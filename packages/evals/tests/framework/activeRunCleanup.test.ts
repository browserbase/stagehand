import { describe, expect, it, vi } from "vitest";
import {
  abortActiveRun,
  cleanupActiveRunResources,
  isHardStopped,
  registerActiveRunCleanup,
  stopRunOnEscape,
  whenHardStopped,
} from "../../framework/activeRunCleanup.js";

describe("active run cleanup", () => {
  it("upgrades a cooperative abort by cleaning active resources", async () => {
    const cleanup = vi.fn(async () => {});
    const unregister = registerActiveRunCleanup(cleanup);
    const controller = new AbortController();

    await abortActiveRun(controller, "cooperative");
    expect(controller.signal.reason).toBe("cooperative");
    expect(cleanup).not.toHaveBeenCalled();

    await abortActiveRun(controller, "aggressive");
    expect(controller.signal.reason).toBe("cooperative");
    expect(cleanup).toHaveBeenCalledTimes(1);

    await abortActiveRun(controller, "aggressive");
    expect(cleanup).toHaveBeenCalledTimes(1);

    unregister();
  });

  it("attempts every cleanup when one throws synchronously", async () => {
    const synchronousFailure = vi.fn(() => {
      throw new Error("synchronous cleanup failure");
    }) as unknown as () => Promise<void>;
    const laterCleanup = vi.fn(async () => {});
    registerActiveRunCleanup(synchronousFailure);
    registerActiveRunCleanup(laterCleanup);

    await expect(cleanupActiveRunResources()).resolves.toBeUndefined();

    expect(synchronousFailure).toHaveBeenCalledOnce();
    expect(laterCleanup).toHaveBeenCalledOnce();
  });

  it("esc stops after in-flight rows first, then stops them now", async () => {
    const cleanup = vi.fn(async () => {});
    const unregister = registerActiveRunCleanup(cleanup);
    const controller = new AbortController();
    const shown: string[] = [];

    stopRunOnEscape(controller, (mode) => shown.push(mode));
    expect(controller.signal.aborted).toBe(true);
    expect(isHardStopped(controller.signal)).toBe(false);
    expect(cleanup).not.toHaveBeenCalled();

    stopRunOnEscape(controller, (mode) => shown.push(mode));
    await vi.waitFor(() => expect(cleanup).toHaveBeenCalledTimes(1));
    expect(isHardStopped(controller.signal)).toBe(true);
    expect(shown).toEqual(["cooperative", "aggressive"]);
    expect(isHardStopped(undefined)).toBe(false);

    unregister();
  });

  it("shares one cleanup across repeated hard stops and waits for it", async () => {
    let finishCleanup!: () => void;
    const cleanup = vi.fn(() => new Promise<void>((resolve) => (finishCleanup = resolve)));
    const unregister = registerActiveRunCleanup(cleanup);
    const controller = new AbortController();
    let released = false;
    void whenHardStopped(controller.signal).then(() => (released = true));

    const first = abortActiveRun(controller, "aggressive");
    // A second Esc while the sessions are still closing.
    const second = abortActiveRun(controller, "aggressive");
    // Long enough for a second, empty cleanup to finish and release early.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(released).toBe(false);

    finishCleanup();
    await Promise.all([first, second]);
    expect(released).toBe(true);
    expect(cleanup).toHaveBeenCalledTimes(1);
    unregister();
  });
});

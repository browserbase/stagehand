import { describe, expect, it, vi } from "vitest";
import {
  abortActiveRun,
  cleanupActiveRunResources,
  isHardStopped,
  registerActiveRunCleanup,
  stopRunOnEscape,
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
});

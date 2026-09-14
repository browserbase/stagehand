import { describe, expect, it, vi } from "vitest";
import {
  abortActiveRun,
  cleanupActiveRunResources,
  registerActiveRunCleanup,
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
});

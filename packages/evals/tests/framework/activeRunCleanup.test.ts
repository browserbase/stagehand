import { describe, expect, it, vi } from "vitest";
import { abortActiveRun, registerActiveRunCleanup } from "../../framework/activeRunCleanup.js";

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

    unregister();
  });
});

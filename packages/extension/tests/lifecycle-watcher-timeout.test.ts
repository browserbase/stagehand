import { describe, expect, it, vi } from "vitest";
import type { LoadState } from "@browserbasehq/stagehand-protocol/types";
import { TimeoutError } from "../errors.js";
import type { CDPSessionLike } from "../understudy/cdp.js";
import { LifecycleWatcher } from "../understudy/lifecycleWatcher.js";
import type { NetworkManager } from "../understudy/networkManager.js";
import type { Page } from "../understudy/page.js";

function createWatcher(
  waitForMainLoadState: (state: LoadState, timeout: number) => Promise<void>,
  waitUntil: LoadState = "networkidle",
): LifecycleWatcher {
  const page = {
    registry: { frames: new Map() },
    mainFrameId: () => "main",
    waitForMainLoadState: vi.fn(waitForMainLoadState),
  } as unknown as Page;
  const mainSession = { on: vi.fn(), off: vi.fn() } as unknown as CDPSessionLike;
  return new LifecycleWatcher({
    page,
    mainSession,
    networkManager: {} as NetworkManager,
    waitUntil,
    timeout: 1_000,
  });
}

describe("LifecycleWatcher load-stage errors", () => {
  it.each(["load", "domcontentloaded", "networkidle"] as const)(
    "reports a %s load-stage timeout as a TimeoutError against the full budget",
    async (waitUntil) => {
      const watcher = createWatcher(async (state, timeout) => {
        throw new TimeoutError(`waitForMainLoadState(${state})`, timeout - 1);
      }, waitUntil);
      const stage = waitUntil === "domcontentloaded" ? "domcontentloaded" : "load";

      const error = await watcher.wait().catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(TimeoutError);
      expect((error as Error).message).toBe(`${stage} timed out after 1000ms`);
    },
  );

  it("passes through non-timeout errors", async () => {
    const failure = new Error("session closed");
    const watcher = createWatcher(async () => {
      throw failure;
    });

    await expect(watcher.wait()).rejects.toBe(failure);
  });
});

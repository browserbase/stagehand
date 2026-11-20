import { afterEach, describe, expect, it, vi } from "vitest";
import type { CDPSessionLike } from "../understudy/cdp.js";
import { LifecycleWatcher } from "../understudy/lifecycleWatcher.js";
import type { NetworkManager } from "../understudy/networkManager.js";
import type { Page } from "../understudy/page.js";
import type { WaitForIdleOptions } from "../types/private/network.js";

async function passiveIdleOptions(loaderId: string | undefined): Promise<WaitForIdleOptions> {
  const frames = new Map(loaderId ? [["main", { lastSeen: { id: "main", loaderId } }]] : []);
  const page = {
    registry: { frames },
    mainFrameId: () => "main",
    waitForMainLoadState: vi.fn(async () => {}),
  } as unknown as Page;
  const waitForIdle = vi.fn((_options: WaitForIdleOptions) => ({
    promise: Promise.resolve(),
    dispose: () => {},
  }));
  const watcher = new LifecycleWatcher({
    page,
    mainSession: { on: vi.fn(), off: vi.fn() } as unknown as CDPSessionLike,
    networkManager: { waitForIdle } as unknown as NetworkManager,
    waitUntil: "networkidle",
    timeout: 1_000,
  });

  await watcher.wait();
  expect(waitForIdle).toHaveBeenCalledTimes(1);
  return waitForIdle.mock.calls[0]![0];
}

describe("LifecycleWatcher without a navigation command", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("counts the current document's in-flight requests when its loader is known", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(5_000);

    const options = await passiveIdleOptions("loader-1");
    expect(options.startTime).toBe(0);
    expect(options.filter?.({ loaderId: "loader-1" } as never)).toBe(true);
    expect(options.filter?.({ loaderId: "loader-0" } as never)).toBe(false);
  });

  it("only counts new requests when the current loader is unknown", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(5_000);

    const options = await passiveIdleOptions(undefined);
    expect(options.startTime).toBe(5_000);
  });
});

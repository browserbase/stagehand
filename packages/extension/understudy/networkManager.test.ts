import { describe, expect, it } from "vitest";
import type { CDPSessionLike } from "./cdp.js";
import { NetworkManager } from "./networkManager.js";

type Handler = (evt: unknown) => void;

/** Minimal CDP session that records listeners so a test can emit events. */
function fakeSession(id?: string) {
  const handlers = new Map<string, Set<Handler>>();
  const session = {
    id,
    on(event: string, fn: Handler) {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event)!.add(fn);
    },
    off(event: string, fn: Handler) {
      handlers.get(event)?.delete(fn);
    },
    send: async () => ({}),
    emit(event: string, payload: unknown) {
      for (const fn of handlers.get(event) ?? []) fn(payload);
    },
  };
  return session as typeof session & CDPSessionLike;
}

function startRequest(session: ReturnType<typeof fakeSession>, requestId: string) {
  session.emit("Network.requestWillBeSent", {
    requestId,
    type: "Fetch",
    request: { url: `https://example.com/${requestId}` },
  });
}

describe("NetworkManager.waitForIdle", () => {
  it("resolves when a session is untracked while its request is in flight", async () => {
    const network = new NetworkManager();
    const main = fakeSession();
    const oopif = fakeSession("oopif-1");
    network.trackSession(main);
    network.trackSession(oopif);

    const handle = network.waitForIdle({
      startTime: Date.now() - 1,
      idleTimeMs: 50,
      timeout: 2_000,
    });

    // An out-of-process iframe starts a request, then detaches before it finishes.
    startRequest(oopif, "r1");
    network.untrackSession("oopif-1");

    await expect(handle.promise).resolves.toBeUndefined();
  });

  it("keeps waiting for requests in sessions that are still tracked", async () => {
    const network = new NetworkManager();
    const main = fakeSession();
    network.trackSession(main);

    const handle = network.waitForIdle({
      startTime: Date.now() - 1,
      idleTimeMs: 50,
      timeout: 300,
    });
    startRequest(main, "r1");

    await expect(handle.promise).rejects.toThrow(/networkidle timed out/);
  });
});

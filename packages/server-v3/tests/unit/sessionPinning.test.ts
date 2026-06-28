import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { describe, it } from "node:test";

import type { FastifyRequest } from "fastify";
import type { V3 } from "@browserbasehq/stagehand";

import { InMemorySessionStore } from "../../src/lib/InMemorySessionStore.js";
import type { CreateSessionParams } from "../../src/lib/SessionStore.js";
import {
  destroySessionStore,
  initializeSessionStore,
} from "../../src/lib/sessionStoreManager.js";
import { withSession } from "../../src/lib/withSession.js";

const PARAMS: CreateSessionParams = {
  browserType: "local",
  modelName: "openai/gpt-4o",
};

/**
 * Inject a fake V3 instance onto a session node so getOrCreateStagehand returns
 * it without launching a real browser. Returns a `closed` probe.
 */
function injectFakeStagehand(
  store: InMemorySessionStore,
  sessionId: string,
): { wasClosed: () => boolean } {
  let closed = false;
  const fake = {
    close: async () => {
      closed = true;
    },
    connectURL: () => "ws://fake",
  } as unknown as V3;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (store as any).items.get(sessionId).stagehand = fake;
  return { wasClosed: () => closed };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const node = (store: InMemorySessionStore, id: string): any =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (store as any).items.get(id);

describe("session pinning", () => {
  it("does not evict an in-use session under capacity pressure", async () => {
    const store = new InMemorySessionStore({ maxCapacity: 1 });
    await store.createSession("A", PARAMS);
    injectFakeStagehand(store, "A");
    await store.getOrCreateStagehand("A", {}); // pin A (inUse = 1)

    // Capacity is 1, but A is pinned: creating B must NOT tear down A.
    await store.createSession("B", PARAMS);
    assert.equal(await store.hasSession("A"), true);
    assert.equal(await store.hasSession("B"), true);

    // Once released, A becomes evictable again.
    await store.releaseSession("A");
    await store.createSession("C", PARAMS);
    assert.equal(await store.hasSession("A"), false);
  });

  it("does not TTL-expire an in-use session", async () => {
    const store = new InMemorySessionStore({ maxCapacity: 100, ttlMs: 1000 });
    await store.createSession("A", PARAMS);
    injectFakeStagehand(store, "A");
    await store.getOrCreateStagehand("A", {}); // pin

    node(store, "A").expiry = Date.now() - 1; // force expired
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (store as any).cleanupExpired();
    assert.equal(await store.hasSession("A"), true); // survives: in use

    await store.releaseSession("A"); // unpin; expiry refreshed
    node(store, "A").expiry = Date.now() - 1; // force expired again
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (store as any).cleanupExpired();
    assert.equal(node(store, "A"), undefined); // now reaped
  });

  it("requires all concurrent holders to release before eviction, never going negative", async () => {
    const store = new InMemorySessionStore({ maxCapacity: 1 });
    await store.createSession("A", PARAMS);
    injectFakeStagehand(store, "A");
    await store.getOrCreateStagehand("A", {});
    await store.getOrCreateStagehand("A", {}); // inUse = 2
    assert.equal(node(store, "A").inUse, 2);

    await store.createSession("B", PARAMS);
    await store.releaseSession("A"); // inUse = 1, still pinned
    await store.createSession("C", PARAMS);
    assert.equal(await store.hasSession("A"), true);

    // Extra releases must clamp at 0, not go negative.
    await store.releaseSession("A");
    await store.releaseSession("A");
    assert.equal(node(store, "A").inUse, 0);

    await store.createSession("D", PARAMS);
    assert.equal(await store.hasSession("A"), false); // now evicted
  });

  it("explicit endSession closes a session even while in use", async () => {
    const store = new InMemorySessionStore();
    await store.createSession("A", PARAMS);
    const probe = injectFakeStagehand(store, "A");
    await store.getOrCreateStagehand("A", {}); // pin

    await store.endSession("A");
    assert.equal(probe.wasClosed(), true);
    assert.equal(node(store, "A"), undefined);
  });
});

describe("withSession", () => {
  it("releases exactly once when the request aborts before the handler finishes", async () => {
    const store = initializeSessionStore();
    try {
      await store.createSession("A", PARAMS);
      injectFakeStagehand(store as InMemorySessionStore, "A");

      let releaseCount = 0;
      const origRelease = store.releaseSession.bind(store);
      store.releaseSession = (id: string) => {
        releaseCount += 1;
        return origRelease(id);
      };

      const raw = new EventEmitter();
      const request = { raw } as unknown as FastifyRequest;

      let finishHandler: () => void = () => {};
      const handlerDone = new Promise<void>((resolve) => {
        finishHandler = resolve;
      });

      const p = withSession("A", {}, request, async () => {
        await handlerDone; // still running...
        return "ok";
      });

      // Let withSession finish acquiring and register its "close" listener
      // (it suspends at the async acquire before attaching the handler).
      await new Promise((resolve) => setTimeout(resolve, 0));

      raw.emit("close"); // client aborts mid-handler
      assert.equal(releaseCount, 1, "abort should release the pin immediately");
      assert.equal(node(store as InMemorySessionStore, "A").inUse, 0);

      finishHandler();
      assert.equal(await p, "ok");
      // The finally path must not double-release.
      assert.equal(releaseCount, 1);
    } finally {
      await destroySessionStore();
    }
  });
});

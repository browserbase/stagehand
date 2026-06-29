import assert from "node:assert/strict";
import { describe, it } from "node:test";

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

  it("ignores an unmatched release without refreshing TTL", async () => {
    const store = new InMemorySessionStore({ maxCapacity: 100, ttlMs: 1000 });
    await store.createSession("A", PARAMS);
    node(store, "A").expiry = 12345; // sentinel

    // No matching acquire: a stray release must be a complete no-op.
    await store.releaseSession("A");

    assert.equal(node(store, "A").inUse, 0);
    assert.equal(node(store, "A").expiry, 12345, "TTL must not be refreshed");
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
  it("keeps the session pinned until fn settles, then releases exactly once", async () => {
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

      let finishHandler: () => void = () => {};
      const handlerDone = new Promise<void>((resolve) => {
        finishHandler = resolve;
      });

      const p = withSession("A", {}, async () => {
        await handlerDone; // still running...
        return "ok";
      });

      // While fn is in flight the session must stay pinned and unreleased.
      await new Promise((resolve) => setTimeout(resolve, 0));
      assert.equal(releaseCount, 0, "must not release while fn is running");
      assert.equal(node(store as InMemorySessionStore, "A").inUse, 1);

      finishHandler();
      assert.equal(await p, "ok");
      assert.equal(releaseCount, 1, "releases exactly once after fn settles");
      assert.equal(node(store as InMemorySessionStore, "A").inUse, 0);
    } finally {
      await destroySessionStore();
    }
  });

  it("surfaces a release failure instead of swallowing it", async () => {
    const store = initializeSessionStore();
    const originalConsoleError = console.error;
    let errorLogs = 0;
    console.error = () => {
      errorLogs += 1;
    };
    try {
      await store.createSession("A", PARAMS);
      injectFakeStagehand(store as InMemorySessionStore, "A");
      store.releaseSession = () => {
        throw new Error("release boom");
      };

      // The handler result is still returned; the release failure is recorded,
      // not thrown (a throw from finally would clobber the result).
      const result = await withSession("A", {}, async () => "ok");
      assert.equal(result, "ok");
      assert.equal(errorLogs, 1, "release failure should be recorded");
    } finally {
      console.error = originalConsoleError;
      await destroySessionStore();
    }
  });

  it("releases the pin when fn throws", async () => {
    const store = initializeSessionStore();
    try {
      await store.createSession("A", PARAMS);
      injectFakeStagehand(store as InMemorySessionStore, "A");

      await assert.rejects(
        withSession("A", {}, async () => {
          throw new Error("boom");
        }),
        /boom/,
      );
      assert.equal(node(store as InMemorySessionStore, "A").inUse, 0);
    } finally {
      await destroySessionStore();
    }
  });
});

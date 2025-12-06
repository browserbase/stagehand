import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";

import { FastifyBaseLogger } from "fastify";

import {
  SessionCache,
  type CachedStagehandEntry as RealCachedStagehandEntry,
} from "./sessionCache.js";

// Mock the Stagehand class for testing
class MockStagehand {
  public closed = false;
  close(): void {
    this.closed = true;
  }
}

const mockServerLogger: FastifyBaseLogger = {
  info: () => {},
  error: () => {},
  warn: () => {},
} as unknown as FastifyBaseLogger;

// Define a type for the test environment that uses MockStagehand
// This is a simplified version for testing cache mechanics, not extending RealCachedStagehandEntry
interface TestCachedStagehandEntry {
  stagehand: MockStagehand;
  loggerRef: { current?: (data: unknown) => void };
}

describe("SessionCache", () => {
  const DEFAULT_MAX_CAPACITY = 100;
  const DEFAULT_TTL_MS = 30_000;
  const SHORT_TTL_MS = 50;
  const LONGER_TTL_MS = 100;
  const WAIT_TIME_LESS_THAN_TTL = 40;
  const WAIT_TIME_GREATER_THAN_TTL = 60;
  const IMMEDIATE_CALLBACK_WAIT = 0;
  const ASYNC_CALLBACK_WAIT_MS = 10;
  const CAPACITY_ONE = 1;
  const CAPACITY_TWO = 2;
  const CAPACITY_THREE = 3;

  describe("Basic Operations", () => {
    it("should create a cache with default settings", () => {
      const cache = new SessionCache(mockServerLogger);
      const config = cache.getConfig();

      assert.equal(config.maxCapacity, DEFAULT_MAX_CAPACITY);
      assert.equal(config.ttlMs, DEFAULT_TTL_MS);
      assert.equal(cache.size, 0);
    });

    it("should create a cache with custom settings", () => {
      const customMaxCapacity = 50;
      const customTtlMs = 15_000;
      const cache = new SessionCache(
        mockServerLogger,
        undefined,
        customMaxCapacity,
        customTtlMs,
      );
      const config = cache.getConfig();

      assert.equal(config.maxCapacity, customMaxCapacity);
      assert.equal(config.ttlMs, customTtlMs);
    });

    it("should throw error when max capacity is 0 or negative", () => {
      assert.throws(() => {
        // eslint-disable-next-line no-new
        new SessionCache(mockServerLogger, undefined, 0);
      }, /Max capacity must be greater than 0/);

      assert.throws(() => {
        // eslint-disable-next-line no-new
        new SessionCache(mockServerLogger, undefined, -1);
      }, /Max capacity must be greater than 0/);
    });

    it("should set and get cache entries", () => {
      const cache = new SessionCache(mockServerLogger);
      const mockStagehand = new MockStagehand();
      const entry: TestCachedStagehandEntry = {
        stagehand: mockStagehand,
        loggerRef: { current: undefined },
      };

      cache.set("session1", entry as unknown as RealCachedStagehandEntry);
      assert.equal(cache.size, 1);

      const retrieved = cache.get("session1") as unknown as
        | TestCachedStagehandEntry
        | undefined;
      assert.ok(retrieved, "Retrieved entry should not be undefined");
      assert.equal(retrieved.stagehand, mockStagehand);
    });

    it("should return undefined for non-existent keys", () => {
      const cache = new SessionCache(mockServerLogger);
      const result = cache.get("nonexistent");
      assert.equal(result, undefined);
    });

    it("should delete cache entries", () => {
      const cache = new SessionCache(mockServerLogger);
      const mockStagehand = new MockStagehand();
      const entry: TestCachedStagehandEntry = {
        stagehand: mockStagehand,
        loggerRef: { current: undefined },
      };

      cache.set("session1", entry as unknown as RealCachedStagehandEntry);
      assert.equal(cache.size, 1);

      const deleted = cache.delete("session1");
      assert.equal(deleted, true);
      assert.equal(cache.size, 0);

      const notDeleted = cache.delete("nonexistent");
      assert.equal(notDeleted, false);
    });

    it("should clear all cache entries", () => {
      const cache = new SessionCache(mockServerLogger);
      const mockStagehand1 = new MockStagehand();
      const mockStagehand2 = new MockStagehand();

      cache.set("session1", {
        stagehand: mockStagehand1,
        loggerRef: { current: undefined },
      } as unknown as RealCachedStagehandEntry);
      cache.set("session2", {
        stagehand: mockStagehand2,
        loggerRef: { current: undefined },
      } as unknown as RealCachedStagehandEntry);

      assert.equal(cache.size, CAPACITY_TWO);

      cache.clear();
      assert.equal(cache.size, 0);
      assert.equal(cache.get("session1"), undefined);
      assert.equal(cache.get("session2"), undefined);
    });
  });

  describe("LRU Eviction", () => {
    it("should evict least recently used items when capacity is exceeded", async () => {
      const evictedItems: string[] = [];
      const onEvictCallback = (
        sessionId: string,
        _entry: RealCachedStagehandEntry,
      ): void => {
        evictedItems.push(sessionId);
      };

      const cache = new SessionCache(
        mockServerLogger,
        onEvictCallback,
        CAPACITY_TWO,
      );
      const mockStagehand1 = new MockStagehand();
      const mockStagehand2 = new MockStagehand();
      const mockStagehand3 = new MockStagehand();

      cache.set("session1", {
        stagehand: mockStagehand1,
        loggerRef: { current: undefined },
      } as unknown as RealCachedStagehandEntry);
      cache.set("session2", {
        stagehand: mockStagehand2,
        loggerRef: { current: undefined },
      } as unknown as RealCachedStagehandEntry);

      assert.equal(cache.size, CAPACITY_TWO);

      cache.set("session3", {
        stagehand: mockStagehand3,
        loggerRef: { current: undefined },
      } as unknown as RealCachedStagehandEntry);

      await sleep(IMMEDIATE_CALLBACK_WAIT);

      assert.equal(cache.size, CAPACITY_TWO);
      assert.equal(
        cache.get("session1"),
        undefined,
        "Session1 should be evicted",
      );
      const session2 = cache.get("session2") as unknown as
        | TestCachedStagehandEntry
        | undefined;
      const session3 = cache.get("session3") as unknown as
        | TestCachedStagehandEntry
        | undefined;
      assert.ok(session2, "Session2 should exist");
      assert.equal(session2.stagehand, mockStagehand2);
      assert.ok(session3, "Session3 should exist");
      assert.equal(session3.stagehand, mockStagehand3);
      assert.deepStrictEqual(evictedItems, ["session1"]);
    });

    it("should update LRU order when accessing items", async () => {
      const evictedItems: string[] = [];
      const onEvictCallback = (
        sessionId: string,
        _entry: RealCachedStagehandEntry,
      ): void => {
        evictedItems.push(sessionId);
      };
      const cache = new SessionCache(
        mockServerLogger,
        onEvictCallback,
        CAPACITY_TWO,
      );
      const mockStagehand1 = new MockStagehand();
      const mockStagehand2 = new MockStagehand();
      const mockStagehand3 = new MockStagehand();

      cache.set("session1", {
        stagehand: mockStagehand1,
        loggerRef: { current: undefined },
      } as unknown as RealCachedStagehandEntry);
      cache.set("session2", {
        stagehand: mockStagehand2,
        loggerRef: { current: undefined },
      } as unknown as RealCachedStagehandEntry);

      const session1Initial = cache.get("session1") as unknown as
        | TestCachedStagehandEntry
        | undefined;
      assert.ok(session1Initial, "Session 1 should exist initially");

      cache.set("session3", {
        stagehand: mockStagehand3,
        loggerRef: { current: undefined },
      } as unknown as RealCachedStagehandEntry);
      await sleep(IMMEDIATE_CALLBACK_WAIT);

      const session1After = cache.get("session1") as unknown as
        | TestCachedStagehandEntry
        | undefined;
      assert.ok(session1After, "Session1 should still exist");
      assert.equal(session1After.stagehand, mockStagehand1);
      assert.equal(
        cache.get("session2"),
        undefined,
        "Session2 should be evicted",
      );
      const session3 = cache.get("session3") as unknown as
        | TestCachedStagehandEntry
        | undefined;
      assert.ok(session3, "Session3 should exist");
      assert.equal(session3.stagehand, mockStagehand3);
      assert.deepStrictEqual(evictedItems, ["session2"]);
    });

    it("should evict items when reducing max capacity", async () => {
      const evictedItems: string[] = [];
      const onEvictCallback = (
        sessionId: string,
        _entry: RealCachedStagehandEntry,
      ): void => {
        evictedItems.push(sessionId);
      };

      const cache = new SessionCache(
        mockServerLogger,
        onEvictCallback,
        CAPACITY_THREE,
      );

      const s1 = new MockStagehand();
      const s2 = new MockStagehand();
      const s3 = new MockStagehand();
      cache.set("session1", {
        stagehand: s1,
        loggerRef: { current: undefined },
      } as unknown as RealCachedStagehandEntry);
      cache.set("session2", {
        stagehand: s2,
        loggerRef: { current: undefined },
      } as unknown as RealCachedStagehandEntry);
      cache.set("session3", {
        stagehand: s3,
        loggerRef: { current: undefined },
      } as unknown as RealCachedStagehandEntry);

      assert.equal(cache.size, CAPACITY_THREE);

      cache.updateConfig({ maxCapacity: CAPACITY_ONE });
      await sleep(IMMEDIATE_CALLBACK_WAIT);

      assert.equal(cache.size, CAPACITY_ONE);
      const session3AfterEviction = cache.get("session3") as unknown as
        | TestCachedStagehandEntry
        | undefined;
      assert.ok(session3AfterEviction, "Session 3 (most recent) should remain");
      assert.equal(session3AfterEviction.stagehand, s3);
      assert.equal(
        cache.get("session1"),
        undefined,
        "Session1 should be evicted",
      );
      assert.equal(
        cache.get("session2"),
        undefined,
        "Session2 should be evicted",
      );
      assert.deepStrictEqual(
        evictedItems.sort(),
        ["session1", "session2"].sort(),
      );
    });
  });

  describe("TTL Expiry", () => {
    it("should expire items after TTL", async () => {
      const cache = new SessionCache(
        mockServerLogger,
        undefined,
        DEFAULT_MAX_CAPACITY,
        SHORT_TTL_MS,
      );
      const mockStagehand = new MockStagehand();

      cache.set("session1", {
        stagehand: mockStagehand,
        loggerRef: { current: undefined },
      } as unknown as RealCachedStagehandEntry);

      const session1 = cache.get("session1") as unknown as
        | TestCachedStagehandEntry
        | undefined;
      assert.ok(session1, "Session1 should be accessible immediately");
      assert.equal(session1.stagehand, mockStagehand);

      await sleep(WAIT_TIME_GREATER_THAN_TTL);

      assert.equal(
        cache.get("session1"),
        undefined,
        "Session1 should be expired",
      );
      assert.equal(cache.size, 0, "Cache size should be 0 after expiry");
    });

    it("should refresh TTL when accessing items", async () => {
      const cache = new SessionCache(
        mockServerLogger,
        undefined,
        DEFAULT_MAX_CAPACITY,
        LONGER_TTL_MS,
      );
      const mockStagehand = new MockStagehand();

      cache.set("session1", {
        stagehand: mockStagehand,
        loggerRef: { current: undefined },
      } as unknown as RealCachedStagehandEntry);

      await sleep(WAIT_TIME_LESS_THAN_TTL);

      const session1Accessed = cache.get("session1") as unknown as
        | TestCachedStagehandEntry
        | undefined;
      assert.ok(
        session1Accessed,
        "Session1 should be accessible before expiry",
      );
      assert.equal(session1Accessed.stagehand, mockStagehand);

      await sleep(WAIT_TIME_GREATER_THAN_TTL);

      const session1AfterRefresh = cache.get("session1") as unknown as
        | TestCachedStagehandEntry
        | undefined;
      assert.ok(
        session1AfterRefresh,
        "Session1 should still be accessible after TTL refresh",
      );
      assert.equal(session1AfterRefresh.stagehand, mockStagehand);
    });

    it("should handle TTL of 0 (no expiry)", async () => {
      const noTtl = 0;
      const cache = new SessionCache(
        mockServerLogger,
        undefined,
        DEFAULT_MAX_CAPACITY,
        noTtl,
      );
      const mockStagehand = new MockStagehand();

      cache.set("session1", {
        stagehand: mockStagehand,
        loggerRef: { current: undefined },
      } as unknown as RealCachedStagehandEntry);
      await sleep(SHORT_TTL_MS);

      const session1 = cache.get("session1") as unknown as
        | TestCachedStagehandEntry
        | undefined;
      assert.ok(session1, "Session1 should be accessible with TTL 0");
      assert.equal(session1.stagehand, mockStagehand);
    });
  });

  describe("Configuration Updates", () => {
    it("should update max capacity", () => {
      const cache = new SessionCache(
        mockServerLogger,
        undefined,
        DEFAULT_MAX_CAPACITY,
        DEFAULT_TTL_MS,
      );
      const newMaxCapacity = 200;
      cache.updateConfig({ maxCapacity: newMaxCapacity });

      const config = cache.getConfig();
      assert.equal(config.maxCapacity, newMaxCapacity);
      assert.equal(config.ttlMs, DEFAULT_TTL_MS);
    });

    it("should update TTL", () => {
      const cache = new SessionCache(
        mockServerLogger,
        undefined,
        DEFAULT_MAX_CAPACITY,
        DEFAULT_TTL_MS,
      );
      const newTtlMs = 60_000;
      cache.updateConfig({ ttlMs: newTtlMs });

      const config = cache.getConfig();
      assert.equal(config.maxCapacity, DEFAULT_MAX_CAPACITY);
      assert.equal(config.ttlMs, newTtlMs);
    });

    it("should update both max capacity and TTL", () => {
      const cache = new SessionCache(
        mockServerLogger,
        undefined,
        DEFAULT_MAX_CAPACITY,
        DEFAULT_TTL_MS,
      );
      const newMaxCapacity = 50;
      const newTtlMs = 15_000;
      cache.updateConfig({ maxCapacity: newMaxCapacity, ttlMs: newTtlMs });

      const config = cache.getConfig();
      assert.equal(config.maxCapacity, newMaxCapacity);
      assert.equal(config.ttlMs, newTtlMs);
    });

    it("should throw error when updating to invalid max capacity", () => {
      const cache = new SessionCache(
        mockServerLogger,
        undefined,
        DEFAULT_MAX_CAPACITY,
        DEFAULT_TTL_MS,
      );

      assert.throws(() => {
        cache.updateConfig({ maxCapacity: 0 });
      }, /Max capacity must be greater than 0/);

      assert.throws(() => {
        cache.updateConfig({ maxCapacity: -1 });
      }, /Max capacity must be greater than 0/);
    });
  });

  describe("Eviction Callbacks", () => {
    it("should call eviction callback when items are evicted by capacity limit", async () => {
      const evictedItems: { sessionId: string; stagehandClosed: boolean }[] =
        [];
      const onEvictCallback = (
        sessionId: string,
        entry: RealCachedStagehandEntry,
      ): void => {
        const mockStagehand = entry.stagehand as unknown as MockStagehand;
        // Simulate calling close, which is what the real onEvict does
        mockStagehand.close();
        evictedItems.push({ sessionId, stagehandClosed: mockStagehand.closed });
      };

      const cache = new SessionCache(
        mockServerLogger,
        onEvictCallback,
        CAPACITY_ONE,
      );
      const mockStagehand1 = new MockStagehand();
      const mockStagehand2 = new MockStagehand();

      cache.set("session1", {
        stagehand: mockStagehand1,
        loggerRef: { current: undefined },
      } as unknown as RealCachedStagehandEntry);
      cache.set("session2", {
        stagehand: mockStagehand2,
        loggerRef: { current: undefined },
      } as unknown as RealCachedStagehandEntry);

      await sleep(ASYNC_CALLBACK_WAIT_MS);

      assert.equal(evictedItems.length, 1, "One item should be evicted");
      assert.ok(
        evictedItems[0],
        "Evicted items array should have an element at index 0",
      );
      assert.equal(evictedItems[0].sessionId, "session1");
      assert.equal(
        evictedItems[0].stagehandClosed,
        true,
        "Evicted stagehand should be closed",
      );
    });

    it("should call eviction callback when deleting items", async () => {
      const evictedItems: { sessionId: string; stagehandClosed: boolean }[] =
        [];
      const onEvictCallback = (
        sessionId: string,
        entry: RealCachedStagehandEntry,
      ): void => {
        const mockStagehand = entry.stagehand as unknown as MockStagehand;
        mockStagehand.close();
        evictedItems.push({ sessionId, stagehandClosed: mockStagehand.closed });
      };

      const cache = new SessionCache(mockServerLogger, onEvictCallback);
      const mockStagehand = new MockStagehand();

      cache.set("session1", {
        stagehand: mockStagehand,
        loggerRef: { current: undefined },
      } as unknown as RealCachedStagehandEntry);
      cache.delete("session1");

      await sleep(ASYNC_CALLBACK_WAIT_MS);

      assert.equal(
        evictedItems.length,
        1,
        "One item should be deleted and evicted",
      );
      assert.ok(
        evictedItems[0],
        "Evicted items array should have an element at index 0 after delete",
      );
      assert.equal(evictedItems[0].sessionId, "session1");
      assert.equal(
        evictedItems[0].stagehandClosed,
        true,
        "Deleted stagehand should be closed",
      );
    });

    it("should call eviction callback when clearing cache", async () => {
      const evictedItems: { sessionId: string; stagehandClosed: boolean }[] =
        [];
      const onEvictCallback = (
        sessionId: string,
        entry: RealCachedStagehandEntry,
      ): void => {
        const mockStagehand = entry.stagehand as unknown as MockStagehand;
        mockStagehand.close();
        evictedItems.push({ sessionId, stagehandClosed: mockStagehand.closed });
      };

      const cache = new SessionCache(mockServerLogger, onEvictCallback);
      const mockStagehand1 = new MockStagehand();
      const mockStagehand2 = new MockStagehand();

      cache.set("session1", {
        stagehand: mockStagehand1,
        loggerRef: { current: undefined },
      } as unknown as RealCachedStagehandEntry);
      cache.set("session2", {
        stagehand: mockStagehand2,
        loggerRef: { current: undefined },
      } as unknown as RealCachedStagehandEntry);

      cache.clear();

      await sleep(ASYNC_CALLBACK_WAIT_MS);

      const expectedEvictedCount = 2;
      assert.equal(
        evictedItems.length,
        expectedEvictedCount,
        "Two items should be cleared and evicted",
      );
      const sessionIds = evictedItems.map((item) => item.sessionId).sort();
      assert.deepStrictEqual(sessionIds, ["session1", "session2"].sort());
      assert.ok(
        evictedItems.every((item) => item.stagehandClosed),
        "All cleared stagehands should be closed",
      );
    });

    it("should call eviction callback for expired items on get", async () => {
      const evictedItems: { sessionId: string; stagehandClosed: boolean }[] =
        [];
      const onEvictCallback = (
        sessionId: string,
        entry: RealCachedStagehandEntry,
      ): void => {
        const mockStagehand = entry.stagehand as unknown as MockStagehand;
        mockStagehand.close();
        evictedItems.push({ sessionId, stagehandClosed: mockStagehand.closed });
      };

      const cache = new SessionCache(
        mockServerLogger,
        onEvictCallback,
        DEFAULT_MAX_CAPACITY,
        SHORT_TTL_MS,
      );
      const mockStagehand = new MockStagehand();
      cache.set("session1", {
        stagehand: mockStagehand,
        loggerRef: { current: undefined },
      } as unknown as RealCachedStagehandEntry);

      await sleep(WAIT_TIME_GREATER_THAN_TTL);
      cache.get("session1");
      await sleep(IMMEDIATE_CALLBACK_WAIT);

      assert.equal(
        evictedItems.length,
        1,
        "Expired item should trigger eviction callback on get",
      );
      assert.ok(evictedItems[0]);
      assert.equal(evictedItems[0].sessionId, "session1");
      assert.equal(
        evictedItems[0].stagehandClosed,
        true,
        "Expired stagehand should be closed on get",
      );
    });
  });

  describe("Edge Cases", () => {
    it("should handle updating existing cache entries", () => {
      const cache = new SessionCache(mockServerLogger);
      const mockStagehand1 = new MockStagehand();
      const mockStagehand2 = new MockStagehand();

      const logger1 = (): void => {
        /* mock */
      };
      const logger2 = (): void => {
        /* mock */
      };

      cache.set("session1", {
        stagehand: mockStagehand1,
        loggerRef: { current: logger1 },
      } as unknown as RealCachedStagehandEntry);

      assert.equal(cache.size, 1);
      let retrieved = cache.get("session1") as unknown as
        | TestCachedStagehandEntry
        | undefined;
      assert.ok(retrieved, "Entry should exist after first set");
      assert.equal(retrieved.stagehand, mockStagehand1);
      assert.equal(retrieved.loggerRef.current, logger1);

      cache.set("session1", {
        stagehand: mockStagehand2,
        loggerRef: { current: logger2 },
      } as unknown as RealCachedStagehandEntry);

      assert.equal(cache.size, 1);
      retrieved = cache.get("session1") as unknown as
        | TestCachedStagehandEntry
        | undefined;
      assert.ok(retrieved, "Entry should exist after second set");
      assert.equal(retrieved.stagehand, mockStagehand2);
      assert.equal(retrieved.loggerRef.current, logger2);
    });

    it("should handle empty cache operations gracefully", () => {
      const cache = new SessionCache(mockServerLogger);

      assert.equal(cache.get("nonexistent"), undefined);
      assert.equal(cache.delete("nonexistent"), false);

      cache.clear();
      assert.equal(cache.size, 0);
    });

    it("should maintain correct size after various operations", () => {
      const cache = new SessionCache(
        mockServerLogger,
        undefined,
        CAPACITY_THREE,
      );

      assert.equal(cache.size, 0, "Initial size should be 0");

      cache.set("s1", {
        stagehand: new MockStagehand(),
        loggerRef: { current: undefined },
      } as unknown as RealCachedStagehandEntry);
      assert.equal(cache.size, 1, "Size after adding s1");

      cache.set("s2", {
        stagehand: new MockStagehand(),
        loggerRef: { current: undefined },
      } as unknown as RealCachedStagehandEntry);
      assert.equal(cache.size, CAPACITY_TWO, "Size after adding s2");

      cache.delete("s1");
      assert.equal(cache.size, 1, "Size after deleting s1");

      cache.set("s3", {
        stagehand: new MockStagehand(),
        loggerRef: { current: undefined },
      } as unknown as RealCachedStagehandEntry);
      assert.equal(cache.size, CAPACITY_TWO, "Size after adding s3 (s2, s3)");

      cache.set("s4", {
        stagehand: new MockStagehand(),
        loggerRef: { current: undefined },
      } as unknown as RealCachedStagehandEntry);
      assert.equal(
        cache.size,
        CAPACITY_THREE,
        "Size after adding s4 (s2, s3, s4) - at capacity",
      );

      cache.set("s5", {
        stagehand: new MockStagehand(),
        loggerRef: { current: undefined },
      } as unknown as RealCachedStagehandEntry);
      assert.equal(
        cache.size,
        CAPACITY_THREE,
        "Size after adding s5 (s3, s4, s5) - s2 evicted, should remain at capacity",
      );

      cache.clear();
      assert.equal(cache.size, 0, "Size after clear");
    });
  });
});

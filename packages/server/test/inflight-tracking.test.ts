/**
 * Test in-flight request tracking prevents TTL expiry during active requests.
 *
 * This test uses a very short TTL (100ms) to verify that:
 * 1. Sessions with in-flight requests are NOT evicted even after TTL expires
 * 2. Sessions ARE evicted after TTL expires once the request completes
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { InMemorySessionStore } from '../src/lib/InMemorySessionStore.js';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe('In-flight request tracking', () => {
  let store: InMemorySessionStore;
  const TTL_MS = 100; // Very short TTL for testing
  const sessionId = 'test-session-123';

  beforeEach(async () => {
    store = new InMemorySessionStore({ ttlMs: TTL_MS, maxCapacity: 10 });
    await store.createSession(sessionId, {
      browserType: 'local',
      modelName: 'openai/gpt-4o',
    });
  });

  afterEach(async () => {
    await store.destroy();
  });

  it('should NOT evict session while request is in-flight', async () => {
    // Simulate starting a request by incrementing counter
    // @ts-expect-error - accessing private for testing
    const node = store.items.get(sessionId);
    expect(node).toBeDefined();
    node!.inFlightRequests++;

    // Wait longer than TTL
    await sleep(TTL_MS + 50);

    // Trigger cleanup
    // @ts-expect-error - accessing private for testing
    await store.cleanupExpired();

    // Session should still exist because inFlightRequests > 0
    const exists = await store.hasSession(sessionId);
    expect(exists).toBe(true);
  });

  it('should evict session after request completes and TTL expires', async () => {
    // Simulate starting a request
    // @ts-expect-error - accessing private for testing
    const node = store.items.get(sessionId);
    expect(node).toBeDefined();
    node!.inFlightRequests++;

    // Release the session (simulate request completion)
    store.releaseSession(sessionId);
    expect(node!.inFlightRequests).toBe(0);

    // Set expiry to past (simulating TTL elapsed)
    node!.expiry = Date.now() - 1000;

    // Trigger cleanup
    // @ts-expect-error - accessing private for testing
    await store.cleanupExpired();

    // Session should be evicted now
    const exists = await store.hasSession(sessionId);
    expect(exists).toBe(false);
  });

  it('should handle multiple concurrent in-flight requests', async () => {
    // @ts-expect-error - accessing private for testing
    const node = store.items.get(sessionId);
    expect(node).toBeDefined();

    // Simulate 3 concurrent requests
    node!.inFlightRequests++;
    node!.inFlightRequests++;
    node!.inFlightRequests++;
    expect(node!.inFlightRequests).toBe(3);

    // Set expiry to past
    node!.expiry = Date.now() - 1000;

    // Trigger cleanup - should not evict because inFlightRequests > 0
    // @ts-expect-error - accessing private for testing
    await store.cleanupExpired();
    expect(await store.hasSession(sessionId)).toBe(true);

    // Release 2 requests
    store.releaseSession(sessionId);
    store.releaseSession(sessionId);
    expect(node!.inFlightRequests).toBe(1);

    // Still should not evict
    // @ts-expect-error - accessing private for testing
    await store.cleanupExpired();
    expect(await store.hasSession(sessionId)).toBe(true);

    // Release last request
    store.releaseSession(sessionId);
    expect(node!.inFlightRequests).toBe(0);

    // Now should evict
    // @ts-expect-error - accessing private for testing
    await store.cleanupExpired();
    expect(await store.hasSession(sessionId)).toBe(false);
  });

  it('should not go below zero on releaseSession', async () => {
    // Call releaseSession without incrementing first
    store.releaseSession(sessionId);
    store.releaseSession(sessionId);

    // @ts-expect-error - accessing private for testing
    const node = store.items.get(sessionId);
    expect(node!.inFlightRequests).toBe(0);
  });
});

import type { Stagehand as V3Stagehand } from "@browserbasehq/stagehand";

import { getSessionStore } from "./sessionStoreManager.js";
import type { RequestContext } from "./SessionStore.js";

/**
 * Acquire a session's V3 instance, run `fn`, and release exactly once when
 * `fn` settles.
 *
 * The session is pinned — excluded from LRU eviction and TTL expiry — for the
 * full duration of `fn`, including agent "think time" when no CDP traffic
 * flows. Release happens only in the `finally`, i.e. strictly AFTER `fn`
 * settles, so the session can never be evicted while the handler is still
 * using its Stagehand instance.
 *
 * Note: we intentionally do NOT release on client disconnect. If the client
 * goes away, the handler keeps running server-side (and may still be driving
 * the browser — e.g. completing a payment); releasing then would let the
 * session be evicted mid-operation, the exact bug this pinning prevents. The
 * handler is bounded by its own step/timeout limits, so the `finally` always
 * runs and the pin is released when the work actually finishes.
 *
 * This is the only supported way to use a session's V3 instance for a request:
 * callers must never hold a stagehand reference past the end of `fn`.
 *
 * Acquire failures propagate to the caller before any pin is taken.
 */
export async function withSession<T>(
  sessionId: string,
  ctx: RequestContext,
  fn: (stagehand: V3Stagehand) => Promise<T>,
): Promise<T> {
  const sessionStore = getSessionStore();
  const stagehand = (await sessionStore.getOrCreateStagehand(
    sessionId,
    ctx,
  )) as V3Stagehand;

  try {
    return await fn(stagehand);
  } finally {
    try {
      await sessionStore.releaseSession(sessionId);
    } catch (err) {
      // A failed release leaves the session pinned (inUse not decremented),
      // which leaks capacity. Don't rethrow (that would clobber the handler's
      // result/error in a finally) — record it so the leak is detectable.
      console.error(
        `Failed to release session ${sessionId}; it may remain pinned:`,
        err,
      );
    }
  }
}

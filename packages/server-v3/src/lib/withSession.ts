import type { FastifyRequest } from "fastify";
import type { Stagehand as V3Stagehand } from "@browserbasehq/stagehand";

import { getSessionStore } from "./sessionStoreManager.js";
import type { RequestContext } from "./SessionStore.js";

/**
 * Acquire a session's V3 instance, run `fn`, and guarantee exactly one release.
 *
 * The session is pinned — excluded from LRU eviction and TTL expiry — for the
 * full duration of `fn`, including agent "think time" when no CDP traffic flows.
 * This is the only supported way to use a session's V3 instance for a request:
 * callers must never hold a stagehand reference past the end of `fn`.
 *
 * Release fires from both the `finally` and the request "close" event, guarded
 * so it runs at most once. `close` (unlike `onResponse`) also fires on client
 * abort / socket teardown, so an aborted request can't leak a permanent pin.
 *
 * Acquire failures propagate to the caller before any pin is taken.
 */
export async function withSession<T>(
  sessionId: string,
  ctx: RequestContext,
  request: FastifyRequest,
  fn: (stagehand: V3Stagehand) => Promise<T>,
): Promise<T> {
  const sessionStore = getSessionStore();
  const stagehand = (await sessionStore.getOrCreateStagehand(
    sessionId,
    ctx,
  )) as V3Stagehand;

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    request.raw.off("close", release);
    void Promise.resolve(sessionStore.releaseSession(sessionId)).catch(() => {
      // best-effort release
    });
  };
  request.raw.once("close", release);

  try {
    return await fn(stagehand);
  } finally {
    release();
  }
}

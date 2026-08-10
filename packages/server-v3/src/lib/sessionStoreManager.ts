import { InMemorySessionStore } from "./InMemorySessionStore.js";
import type { SessionCacheConfig, SessionStore } from "./SessionStore.js";

let sessionStore: SessionStore | null = null;

export function initializeSessionStore(
  config?: SessionCacheConfig,
): SessionStore {
  if (!sessionStore) {
    sessionStore = new InMemorySessionStore(config);
  }
  return sessionStore;
}

export function getSessionStore(): SessionStore {
  if (!sessionStore) {
    throw new Error("Session store has not been initialized");
  }
  return sessionStore;
}

export async function destroySessionStore(): Promise<void> {
  if (sessionStore) {
    await sessionStore.destroy();
    sessionStore = null;
  }
}

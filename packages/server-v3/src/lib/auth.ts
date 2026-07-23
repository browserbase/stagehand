import { createHash, timingSafeEqual } from "node:crypto";

import Browserbase from "@browserbasehq/sdk";
import type { FastifyRequest } from "fastify";

const BROWSERBASE_AUTH_HEADER = "x-bb-api-key";
const SERVER_AUTH_HEADER = "x-stagehand-api-key";
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_MAX_CACHE_ENTRIES = 1_000;

type ApiKeyVerifier = (apiKey: string) => Promise<boolean>;
type SessionApiKeyResolver = (sessionId: string) => Promise<string | undefined>;

interface AuthCacheEntry {
  authenticated: boolean;
  expiresAt: number;
}

interface AuthMiddlewareOptions {
  verifyApiKey?: ApiKeyVerifier;
  resolveSessionApiKey?: SessionApiKeyResolver;
  cacheTtlMs?: number;
  maxCacheEntries?: number;
  serverApiKey?: string;
}

const fingerprintApiKey = (apiKey: string): string =>
  createHash("sha256").update(apiKey).digest("hex");

const verifyBrowserbaseApiKey: ApiKeyVerifier = async (apiKey) => {
  try {
    const browserbase = new Browserbase({ apiKey });
    await browserbase.projects.list({ maxRetries: 0, timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
};

const resolveSessionApiKey: SessionApiKeyResolver = async (sessionId) => {
  try {
    const { getSessionStore } = await import("./sessionStoreManager.js");
    const session = await getSessionStore().getSessionConfig(sessionId);
    return session.browserbaseApiKey;
  } catch {
    return undefined;
  }
};

const getSessionId = (request: FastifyRequest): string | undefined => {
  const params = request.params;
  if (!params || typeof params !== "object" || !("id" in params)) {
    return undefined;
  }

  const id = (params as { id?: unknown }).id;
  return typeof id === "string" && id.length > 0 ? id : undefined;
};

const apiKeysMatch = (provided: string, expected: string): boolean => {
  const providedFingerprint = Buffer.from(fingerprintApiKey(provided), "hex");
  const expectedFingerprint = Buffer.from(fingerprintApiKey(expected), "hex");
  return timingSafeEqual(providedFingerprint, expectedFingerprint);
};

/**
 * Builds an authentication middleware with a bounded credential cache.
 *
 * Cache keys are SHA-256 fingerprints so plaintext API keys are not retained.
 * Concurrent requests using the same uncached key share one verification call.
 * Requests for existing sessions must use the key that created the session.
 */
export const createAuthMiddleware = ({
  verifyApiKey = verifyBrowserbaseApiKey,
  resolveSessionApiKey: resolveApiKeyForSession = resolveSessionApiKey,
  cacheTtlMs = DEFAULT_CACHE_TTL_MS,
  maxCacheEntries = DEFAULT_MAX_CACHE_ENTRIES,
  serverApiKey = process.env.STAGEHAND_SERVER_API_KEY,
}: AuthMiddlewareOptions = {}) => {
  const cache = new Map<string, AuthCacheEntry>();
  const pendingVerifications = new Map<string, Promise<boolean>>();

  const cacheResult = (fingerprint: string, authenticated: boolean): void => {
    while (cache.size >= maxCacheEntries) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }

    cache.set(fingerprint, {
      authenticated,
      expiresAt: Date.now() + cacheTtlMs,
    });
  };

  return async (request: FastifyRequest): Promise<boolean> => {
    const serverHeaderValue = request.headers[SERVER_AUTH_HEADER];
    if (serverApiKey && typeof serverHeaderValue === "string") {
      const providedKey = Buffer.from(serverHeaderValue);
      const expectedKey = Buffer.from(serverApiKey);
      if (
        providedKey.length === expectedKey.length &&
        timingSafeEqual(providedKey, expectedKey)
      ) {
        return true;
      }
    }

    const headerValue = request.headers[BROWSERBASE_AUTH_HEADER];
    if (typeof headerValue !== "string" || headerValue.length === 0) {
      return false;
    }

    const sessionId = getSessionId(request);
    if (sessionId) {
      const sessionApiKey = await resolveApiKeyForSession(sessionId);
      return sessionApiKey ? apiKeysMatch(headerValue, sessionApiKey) : false;
    }

    const fingerprint = fingerprintApiKey(headerValue);
    const cached = cache.get(fingerprint);
    if (cached && cached.expiresAt > Date.now()) {
      // Refresh insertion order so eviction follows least-recently-used order.
      cache.delete(fingerprint);
      cache.set(fingerprint, cached);
      return cached.authenticated;
    }
    if (cached) {
      cache.delete(fingerprint);
    }

    const pending = pendingVerifications.get(fingerprint);
    if (pending) {
      return await pending;
    }

    const verification = verifyApiKey(headerValue)
      .catch(() => false)
      .then((authenticated) => {
        cacheResult(fingerprint, authenticated);
        return authenticated;
      })
      .finally(() => {
        pendingVerifications.delete(fingerprint);
      });

    pendingVerifications.set(fingerprint, verification);
    return await verification;
  };
};

export const authMiddleware = createAuthMiddleware();

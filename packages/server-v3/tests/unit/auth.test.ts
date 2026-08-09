import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { FastifyRequest } from "fastify";

import { createAuthMiddleware } from "../../src/lib/auth.js";

const requestWithApiKey = (
  apiKey?: string | string[],
  serverApiKey?: string | string[],
  sessionId?: string,
): FastifyRequest =>
  ({
    headers: {
      ...(apiKey === undefined ? {} : { "x-bb-api-key": apiKey }),
      ...(serverApiKey === undefined
        ? {}
        : { "x-stagehand-api-key": serverApiKey }),
    },
    params: sessionId ? { id: sessionId } : {},
  }) as FastifyRequest;

describe("authMiddleware", () => {
  it("rejects requests without exactly one non-empty API key", async () => {
    let verificationCalls = 0;
    const authenticate = createAuthMiddleware({
      verifyApiKey: async () => {
        verificationCalls += 1;
        return true;
      },
    });

    assert.equal(await authenticate(requestWithApiKey()), false);
    assert.equal(await authenticate(requestWithApiKey("")), false);
    assert.equal(
      await authenticate(requestWithApiKey(["first-key", "second-key"])),
      false,
    );
    assert.equal(verificationCalls, 0);
  });

  it("accepts valid keys and rejects invalid keys", async () => {
    const authenticate = createAuthMiddleware({
      verifyApiKey: async (apiKey) => apiKey === "valid-key",
    });

    assert.equal(await authenticate(requestWithApiKey("valid-key")), true);
    assert.equal(await authenticate(requestWithApiKey("invalid-key")), false);
  });

  it("accepts the configured self-hosted server key", async () => {
    let browserbaseVerificationCalls = 0;
    const authenticate = createAuthMiddleware({
      serverApiKey: "server-key",
      verifyApiKey: async () => {
        browserbaseVerificationCalls += 1;
        return false;
      },
    });

    assert.equal(
      await authenticate(requestWithApiKey(undefined, "server-key")),
      true,
    );
    assert.equal(
      await authenticate(requestWithApiKey(undefined, "wrong-key")),
      false,
    );
    assert.equal(
      await authenticate(requestWithApiKey(undefined, "server-kéy")),
      false,
    );
    assert.equal(
      await authenticate(
        requestWithApiKey(undefined, ["server-key", "server-key"]),
      ),
      false,
    );
    assert.equal(browserbaseVerificationCalls, 0);
  });

  it("fails closed when credential verification throws", async () => {
    const authenticate = createAuthMiddleware({
      verifyApiKey: async () => {
        throw new Error("Browserbase unavailable");
      },
    });

    assert.equal(await authenticate(requestWithApiKey("some-key")), false);
  });

  it("only authorizes the Browserbase key that created a session", async () => {
    let browserbaseVerificationCalls = 0;
    const authenticate = createAuthMiddleware({
      verifyApiKey: async () => {
        browserbaseVerificationCalls += 1;
        return true;
      },
      resolveSessionApiKey: async (sessionId) =>
        sessionId === "owned-session" ? "owner-key" : undefined,
    });

    assert.equal(
      await authenticate(
        requestWithApiKey("owner-key", undefined, "owned-session"),
      ),
      true,
    );
    assert.equal(
      await authenticate(
        requestWithApiKey("different-key", undefined, "owned-session"),
      ),
      false,
    );
    assert.equal(
      await authenticate(
        requestWithApiKey("owner-key", undefined, "missing-session"),
      ),
      false,
    );
    assert.equal(browserbaseVerificationCalls, 0);
  });

  it("caches verification results without retaining plaintext keys", async () => {
    const verifiedKeys: string[] = [];
    const authenticate = createAuthMiddleware({
      verifyApiKey: async (apiKey) => {
        verifiedKeys.push(apiKey);
        return true;
      },
    });

    assert.equal(await authenticate(requestWithApiKey("valid-key")), true);
    assert.equal(await authenticate(requestWithApiKey("valid-key")), true);
    assert.deepEqual(verifiedKeys, ["valid-key"]);
  });

  it("deduplicates concurrent verification of the same key", async () => {
    let resolveVerification: ((authenticated: boolean) => void) | undefined;
    let verificationCalls = 0;
    const authenticate = createAuthMiddleware({
      verifyApiKey: () => {
        verificationCalls += 1;
        return new Promise<boolean>((resolve) => {
          resolveVerification = resolve;
        });
      },
    });

    const first = authenticate(requestWithApiKey("valid-key"));
    const second = authenticate(requestWithApiKey("valid-key"));

    assert.equal(verificationCalls, 1);
    resolveVerification?.(true);
    assert.deepEqual(await Promise.all([first, second]), [true, true]);
  });

  it("evicts the least recently used result when the cache is full", async () => {
    const verifiedKeys: string[] = [];
    const authenticate = createAuthMiddleware({
      maxCacheEntries: 2,
      verifyApiKey: async (apiKey) => {
        verifiedKeys.push(apiKey);
        return true;
      },
    });

    await authenticate(requestWithApiKey("first"));
    await authenticate(requestWithApiKey("second"));
    await authenticate(requestWithApiKey("first"));
    await authenticate(requestWithApiKey("third"));
    await authenticate(requestWithApiKey("second"));

    assert.deepEqual(verifiedKeys, ["first", "second", "third", "second"]);
  });
});

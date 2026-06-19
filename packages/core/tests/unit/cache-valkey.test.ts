import { describe, expect, it, vi, beforeEach } from "vitest";
import { CacheStorage } from "../../lib/v3/cache/CacheStorage.js";

/**
 * Unit tests for the Valkey-backed CacheStorage.
 * These mock the ValkeyClientLike interface to verify key derivation,
 * TTL propagation, graceful error handling, and serialization.
 */

function createMockClient() {
  return {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue("OK"),
    del: vi.fn().mockResolvedValue(1),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

function createValkeyStorage(
  client: ReturnType<typeof createMockClient>,
  options: {
    cacheTtl?: number;
    keyPrefix?: string;
    maxCacheValueBytes?: number;
  } = {},
): CacheStorage {
  // Access private constructor via reflection for testing.
  // In production code, createValkey() handles this.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Ctor = CacheStorage as any;
  return new Ctor(vi.fn(), undefined, undefined, client, {
    host: "localhost",
    ...options,
  });
}

describe("CacheStorage Valkey backend", () => {
  let client: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    client = createMockClient();
  });

  describe("key derivation", () => {
    it("derives act key with explicit category", async () => {
      const storage = createValkeyStorage(client);
      await storage.readJson("abc123def.json", "act");
      expect(client.get).toHaveBeenCalledWith("stagehand:act:abc123def");
    });

    it("derives agent key with explicit category", async () => {
      const storage = createValkeyStorage(client);
      await storage.readJson("xyz789.json", "agent");
      expect(client.get).toHaveBeenCalledWith("stagehand:agent:xyz789");
    });

    it("strips redundant agent- prefix from filename in Valkey key", async () => {
      const storage = createValkeyStorage(client);
      await storage.readJson("agent-abc123.json", "agent");
      expect(client.get).toHaveBeenCalledWith("stagehand:agent:abc123");
    });

    it("defaults to act category when omitted", async () => {
      const storage = createValkeyStorage(client);
      await storage.readJson("abc.json");
      expect(client.get).toHaveBeenCalledWith("stagehand:act:abc");
    });

    it("uses custom keyPrefix", async () => {
      const storage = createValkeyStorage(client, {
        keyPrefix: "myapp",
      });
      await storage.readJson("abc.json", "act");
      expect(client.get).toHaveBeenCalledWith("myapp:act:abc");
    });
  });

  describe("readJson", () => {
    it("returns null value on cache miss", async () => {
      client.get.mockResolvedValue(null);
      const storage = createValkeyStorage(client);
      const result = await storage.readJson("missing.json");
      expect(result).toEqual({ value: null });
    });

    it("deserializes JSON on cache hit", async () => {
      const data = { version: 1, instruction: "click button" };
      client.get.mockResolvedValue(JSON.stringify(data));
      const storage = createValkeyStorage(client);
      const result = await storage.readJson("hit.json");
      expect(result).toEqual({ value: data });
    });

    it("returns error on client failure without throwing", async () => {
      const err = new Error("connection refused");
      client.get.mockRejectedValue(err);
      const storage = createValkeyStorage(client);
      const result = await storage.readJson("fail.json");
      expect(result.value).toBeNull();
      expect(result.error).toBe(err);
    });

    it("returns error on corrupt JSON and deletes the key", async () => {
      client.get.mockResolvedValue("not valid json {{{");
      const storage = createValkeyStorage(client);
      const result = await storage.readJson("corrupt.json");
      expect(result.value).toBeNull();
      expect(result.error).toBeInstanceOf(SyntaxError);
      // Should delete the poisoned key
      expect(client.del).toHaveBeenCalledWith(["stagehand:act:corrupt"]);
    });
  });

  describe("writeJson", () => {
    it("serializes data as JSON string", async () => {
      const storage = createValkeyStorage(client);
      const data = { version: 1, actions: [{ selector: "button" }] };
      await storage.writeJson("key.json", data);
      expect(client.set).toHaveBeenCalledWith(
        "stagehand:act:key",
        JSON.stringify(data),
      );
    });

    it("applies TTL when cacheTtl is set", async () => {
      const storage = createValkeyStorage(client, { cacheTtl: 3600 });
      await storage.writeJson("key.json", { test: true });
      expect(client.set).toHaveBeenCalledWith(
        "stagehand:act:key",
        JSON.stringify({ test: true }),
        { expiry: { type: "EX", count: 3600 } },
      );
    });

    it("omits TTL options when cacheTtl is not set", async () => {
      const storage = createValkeyStorage(client);
      await storage.writeJson("key.json", { test: true });
      expect(client.set).toHaveBeenCalledWith(
        "stagehand:act:key",
        JSON.stringify({ test: true }),
      );
    });

    it("returns error on client failure without throwing", async () => {
      const err = new Error("write timeout");
      client.set.mockRejectedValue(err);
      const storage = createValkeyStorage(client);
      const result = await storage.writeJson("fail.json", {});
      expect(result.error).toBe(err);
    });
  });

  describe("enabled", () => {
    it("reports enabled when valkey client is attached", () => {
      const storage = createValkeyStorage(client);
      expect(storage.enabled).toBe(true);
    });
  });

  describe("isValkey", () => {
    it("reports true when valkey client is attached", () => {
      const storage = createValkeyStorage(client);
      expect(storage.isValkey).toBe(true);
    });

    it("reports false for a disabled (no-op) storage", () => {
      const storage = CacheStorage.create(undefined, vi.fn());
      expect(storage.isValkey).toBe(false);
      expect(storage.enabled).toBe(false);
    });

    it("reports false for a memory-backed storage", () => {
      const storage = CacheStorage.createMemory(vi.fn());
      expect(storage.isValkey).toBe(false);
    });
  });

  describe("close", () => {
    it("closes the valkey client", async () => {
      const storage = createValkeyStorage(client);
      await storage.close();
      expect(client.close).toHaveBeenCalled();
    });

    it("does not throw if close fails", async () => {
      client.close.mockRejectedValue(new Error("already closed"));
      const storage = createValkeyStorage(client);
      await expect(storage.close()).resolves.toBeUndefined();
    });
  });

  describe("createValkey factory (connection failure)", () => {
    it("returns disabled storage when connection fails", async () => {
      const logger = vi.fn();

      // Mock the dynamic import so this test is hermetic — no native binary
      // or network required.
      vi.doMock("iovalkey", () => ({
        default: class MockValkey {
          connect() {
            return Promise.reject(new Error("connect ECONNREFUSED"));
          }
        },
      }));

      const storage = await CacheStorage.createValkey(
        { host: "nonexistent-host-that-cannot-connect", requestTimeout: 500 },
        logger,
      );
      expect(storage.enabled).toBe(false);
      // Should have logged a warning
      expect(logger).toHaveBeenCalledWith(
        expect.objectContaining({
          category: "cache",
          message: expect.stringContaining("unable to initialize valkey cache"),
        }),
      );

      vi.doUnmock("iovalkey");
    });

    it("re-init fallback: replaces closed Valkey storage with file/memory when reconnect fails", async () => {
      const logger = vi.fn();

      // Simulate the state after a successful init() + close():
      // cacheStorage is a Valkey-backed storage whose client has been closed.
      const closedValkeyStorage = createValkeyStorage(createMockClient());
      expect(closedValkeyStorage.isValkey).toBe(true);
      expect(closedValkeyStorage.enabled).toBe(true);

      // On the next init(), createValkey is called but fails.
      vi.doMock("iovalkey", () => ({
        default: class MockValkey {
          connect() {
            return Promise.reject(new Error("connect ECONNREFUSED"));
          }
        },
      }));

      const reconnectAttempt = await CacheStorage.createValkey(
        { host: "unreachable-valkey-host", requestTimeout: 500 },
        logger,
      );

      // Replicate the guard in v3.init():
      // if (valkeyStorage.enabled) { wireCaches(valkeyStorage) }
      // else if (this.cacheStorage.isValkey) { wireCaches(CacheStorage.create(...)) }
      let activeStorage = closedValkeyStorage;
      if (reconnectAttempt.enabled) {
        activeStorage = reconnectAttempt;
      } else if (closedValkeyStorage.isValkey) {
        activeStorage = CacheStorage.create(undefined, logger);
      }

      // The dead Valkey storage must be replaced with a safe no-op storage.
      expect(activeStorage).not.toBe(closedValkeyStorage);
      expect(activeStorage.isValkey).toBe(false);

      vi.doUnmock("iovalkey");
    });

    it("does not clobber existing file-backed storage on connection failure (valkeyHost precedence)", async () => {
      const logger = vi.fn();

      // Simulate the v3.init() precedence logic:
      // 1. A file-backed storage exists (cacheDir was set)
      const fileStorage = CacheStorage.create(
        "/tmp/stagehand-test-cache",
        logger,
      );
      expect(fileStorage.enabled).toBe(true);

      // 2. valkeyHost is also set, so we attempt createValkey
      vi.doMock("iovalkey", () => ({
        default: class MockValkey {
          connect() {
            return Promise.reject(new Error("connect ECONNREFUSED"));
          }
        },
      }));

      const valkeyStorage = await CacheStorage.createValkey(
        { host: "unreachable-valkey-host", requestTimeout: 500 },
        logger,
      );

      // 3. The guard: only replace if Valkey connected successfully
      //    This replicates the `if (valkeyStorage.enabled)` check in v3.init()
      let activeStorage = fileStorage;
      if (valkeyStorage.enabled) {
        activeStorage = valkeyStorage;
      }

      // The file-backed storage must survive — Valkey failure must NOT
      // replace a working cache with a disabled one.
      expect(activeStorage).toBe(fileStorage);
      expect(activeStorage.enabled).toBe(true);
      expect(activeStorage.directory).toBe("/tmp/stagehand-test-cache");

      vi.doUnmock("iovalkey");
    });
  });

  describe("size-limit enforcement", () => {
    it("skips write and returns error when payload exceeds maxCacheValueBytes", async () => {
      const storage = createValkeyStorage(client, {
        maxCacheValueBytes: 50,
      });
      // Create a payload whose JSON serialization exceeds 50 bytes
      const largeData = { content: "a".repeat(100) };
      const result = await storage.writeJson("big.json", largeData);

      expect(result.error).toBeInstanceOf(Error);
      expect((result.error as Error).message).toBe(
        "cache value exceeds size limit",
      );
      // Should include the key as path so callers' guards fire
      expect(result.path).toBe("stagehand:act:big");
      // set() must NOT have been called
      expect(client.set).not.toHaveBeenCalled();
    });

    it("allows write when payload is within maxCacheValueBytes", async () => {
      const storage = createValkeyStorage(client, {
        maxCacheValueBytes: 5_000,
      });
      const smallData = { ok: true };
      const result = await storage.writeJson("small.json", smallData);

      expect(result.error).toBeUndefined();
      expect(client.set).toHaveBeenCalled();
    });

    it("measures byte length not character length for multi-byte content", async () => {
      // Each emoji is 4 bytes in UTF-8 but 2 UTF-16 code units (.length = 2)
      const emoji = "😀";
      const payload = { text: emoji.repeat(10) };
      const serialized = JSON.stringify(payload);
      const charLength = serialized.length;
      const byteLength = Buffer.byteLength(serialized, "utf8");

      // Set limit between char length and byte length to verify byte measurement
      const storage = createValkeyStorage(client, {
        maxCacheValueBytes: charLength + 1,
      });

      if (byteLength > charLength + 1) {
        // The byte length exceeds our limit even though char length doesn't
        const result = await storage.writeJson("emoji.json", payload);
        expect(result.error).toBeInstanceOf(Error);
        expect(client.set).not.toHaveBeenCalled();
      } else {
        // If somehow they're equal, the write should succeed
        const result = await storage.writeJson("emoji.json", payload);
        expect(result.error).toBeUndefined();
      }
    });
  });

  describe("write error includes path for caller guards", () => {
    it("returns valkey key as path on connection error", async () => {
      const err = new Error("write timeout");
      client.set.mockRejectedValue(err);
      const storage = createValkeyStorage(client);
      const result = await storage.writeJson("fail.json", { x: 1 });
      expect(result.error).toBe(err);
      expect(result.path).toBe("stagehand:act:fail");
    });

    it("returns valkey key as path on read error", async () => {
      const err = new Error("connection reset");
      client.get.mockRejectedValue(err);
      const storage = createValkeyStorage(client);
      const result = await storage.readJson("broken.json", "agent");
      expect(result.error).toBe(err);
      expect(result.path).toBe("stagehand:agent:broken");
    });
  });
});

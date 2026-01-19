import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { CacheStorage } from "../../lib/v3/cache/CacheStorage";
import { InMemoryAdapter } from "../../lib/v3/cache/adapters/InMemoryAdapter";
import type { Logger } from "../../lib/v3/types/public";

/**
 * Backward compatibility tests for CacheStorage.
 * These tests ensure that the original API still works after the refactor.
 */

describe("CacheStorage backward compatibility", () => {
  let tmpDir: string;
  const mockLogger: Logger = vi.fn();

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "stagehand-cache-compat-"));
    vi.clearAllMocks();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("CacheStorage.create() with cacheDir string", () => {
    it("should create enabled cache when cacheDir is provided", () => {
      const cache = CacheStorage.create(tmpDir, mockLogger);

      expect(cache.enabled).toBe(true);
      expect(cache.directory).toBe(tmpDir);
    });

    it("should create disabled cache when cacheDir is undefined", () => {
      const cache = CacheStorage.create(undefined, mockLogger);

      expect(cache.enabled).toBe(false);
      expect(cache.directory).toBeUndefined();
    });

    it("should create directory if it doesn't exist", () => {
      const newDir = path.join(tmpDir, "new-cache-dir");
      const cache = CacheStorage.create(newDir, mockLogger);

      expect(cache.enabled).toBe(true);
      expect(fs.existsSync(newDir)).toBe(true);
    });

    it("should log error and create disabled cache when directory creation fails", () => {
      const invalidDir = "/nonexistent-root-12345/cache";
      const cache = CacheStorage.create(invalidDir, mockLogger, {
        label: "test cache",
      });

      expect(cache.enabled).toBe(false);
      expect(mockLogger).toHaveBeenCalledWith(
        expect.objectContaining({
          category: "cache",
          message: expect.stringContaining("unable to initialize test cache"),
          level: 1,
        }),
      );
    });
  });

  describe("readJson/writeJson with cacheDir", () => {
    it("should write and read JSON data", async () => {
      const cache = CacheStorage.create(tmpDir, mockLogger);
      const testData = { key: "value", nested: { data: true } };

      await cache.writeJson("test.json", testData);
      const result = await cache.readJson<typeof testData>("test.json");

      expect(result.value).toEqual(testData);
    });

    it("should return { value: null } for missing files", async () => {
      const cache = CacheStorage.create(tmpDir, mockLogger);

      const result = await cache.readJson("nonexistent.json");

      expect(result.value).toBeNull();
      expect(result.error).toBeUndefined();
    });

    it("should create nested directories for filenames with paths", async () => {
      const cache = CacheStorage.create(tmpDir, mockLogger);
      const fileName = "subdir/nested/cache.json";

      await cache.writeJson(fileName, { nested: true });

      const fullPath = path.join(tmpDir, fileName);
      expect(fs.existsSync(fullPath)).toBe(true);
    });

    it("should return empty object for reads when caching disabled", async () => {
      const cache = CacheStorage.create(undefined, mockLogger);

      const result = await cache.readJson("test.json");

      expect(result.value).toBeNull();
    });

    it("should return empty object for writes when caching disabled", async () => {
      const cache = CacheStorage.create(undefined, mockLogger);

      const result = await cache.writeJson("test.json", { data: "test" });

      expect(result).toEqual({});
    });
  });

  describe("CacheStorage.create() with custom adapter", () => {
    it("should use custom adapter when provided", async () => {
      const customAdapter = new InMemoryAdapter();
      const cache = CacheStorage.create(undefined, mockLogger, {
        adapter: customAdapter,
      });

      expect(cache.enabled).toBe(true);
      expect(cache.storageAdapter).toBe(customAdapter);
    });

    it("should ignore cacheDir when custom adapter is provided", () => {
      const customAdapter = new InMemoryAdapter();
      const cache = CacheStorage.create(tmpDir, mockLogger, {
        adapter: customAdapter,
      });

      // directory should be undefined because we're using custom adapter
      expect(cache.directory).toBeUndefined();
      expect(cache.storageAdapter).toBe(customAdapter);
    });

    it("should use custom adapter for read/write operations", async () => {
      const customAdapter = new InMemoryAdapter();
      const cache = CacheStorage.create(undefined, mockLogger, {
        adapter: customAdapter,
      });

      await cache.writeJson("test.json", { custom: "adapter" });
      const result = await cache.readJson<{ custom: string }>("test.json");

      expect(result.value).toEqual({ custom: "adapter" });
      // Verify it's in the in-memory adapter
      expect(customAdapter.has("test.json")).toBe(true);
    });
  });

  describe("storageAdapter property", () => {
    it("should expose the underlying adapter", () => {
      const cache = CacheStorage.create(tmpDir, mockLogger);

      expect(cache.storageAdapter).toBeDefined();
      expect(cache.storageAdapter.enabled).toBe(true);
    });

    it("should expose disabled adapter when caching is disabled", () => {
      const cache = CacheStorage.create(undefined, mockLogger);

      expect(cache.storageAdapter).toBeDefined();
      expect(cache.storageAdapter.enabled).toBe(false);
    });
  });
});

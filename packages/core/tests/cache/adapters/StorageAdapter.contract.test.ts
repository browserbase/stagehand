import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type { StorageAdapter } from "../../../lib/v3/cache/adapters/types";
import { FilesystemAdapter } from "../../../lib/v3/cache/adapters/FilesystemAdapter";
import { NullAdapter } from "../../../lib/v3/cache/adapters/NullAdapter";
import { InMemoryAdapter } from "../../../lib/v3/cache/adapters/InMemoryAdapter";

/**
 * Contract tests that verify all StorageAdapter implementations
 * follow the expected behavior.
 */

interface TestAdapterFactory {
  name: string;
  create: () => StorageAdapter | Promise<StorageAdapter>;
  cleanup?: () => void | Promise<void>;
  /**
   * Whether this adapter is enabled (supports actual storage).
   * NullAdapter is expected to be disabled.
   */
  expectEnabled: boolean;
}

// Test data
const testData = {
  simple: { key: "value" },
  nested: { level1: { level2: { data: "deep" } } },
  withArray: { items: [1, 2, 3, "four"] },
  withSpecialChars: { path: "path/to/file", unicode: "こんにちは" },
  largeData: { items: Array(1000).fill({ id: 1, name: "test" }) },
};

// Adapter factories for contract testing
const adapterFactories: TestAdapterFactory[] = [
  {
    name: "FilesystemAdapter",
    create: () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "stagehand-test-"));
      const adapter = FilesystemAdapter.create(tmpDir);
      if (!adapter) {
        throw new Error("Failed to create FilesystemAdapter");
      }
      // Store tmpDir for cleanup
      (adapter as FilesystemAdapter & { _tmpDir?: string })._tmpDir = tmpDir;
      return adapter;
    },
    cleanup: function () {
      // Cleanup is handled via beforeEach/afterEach per test
    },
    expectEnabled: true,
  },
  {
    name: "InMemoryAdapter",
    create: () => new InMemoryAdapter(),
    expectEnabled: true,
  },
  {
    name: "InMemoryAdapter (disabled)",
    create: () => new InMemoryAdapter(false),
    expectEnabled: false,
  },
  {
    name: "NullAdapter",
    create: () => new NullAdapter(),
    expectEnabled: false,
  },
];

// Run contract tests for each adapter
for (const factory of adapterFactories) {
  describe(`StorageAdapter contract: ${factory.name}`, () => {
    let adapter: StorageAdapter;
    let tmpDir: string | undefined;

    beforeEach(async () => {
      adapter = await factory.create();
      // Extract tmpDir for cleanup if it's a FilesystemAdapter
      if ("directory" in adapter) {
        tmpDir = (adapter as FilesystemAdapter).directory;
      }
    });

    afterEach(async () => {
      // Clean up filesystem adapter's temp directory
      if (tmpDir && fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
      tmpDir = undefined;
      await factory.cleanup?.();
    });

    describe("enabled property", () => {
      it(`should be ${factory.expectEnabled}`, () => {
        expect(adapter.enabled).toBe(factory.expectEnabled);
      });
    });

    describe("readJson/writeJson", () => {
      if (factory.expectEnabled) {
        it("should write and read simple data", async () => {
          await adapter.writeJson("test-simple.json", testData.simple);
          const result = await adapter.readJson<typeof testData.simple>(
            "test-simple.json",
          );

          expect(result.value).toEqual(testData.simple);
          expect(result.error).toBeUndefined();
        });

        it("should write and read nested data", async () => {
          await adapter.writeJson("test-nested.json", testData.nested);
          const result = await adapter.readJson<typeof testData.nested>(
            "test-nested.json",
          );

          expect(result.value).toEqual(testData.nested);
        });

        it("should write and read data with arrays", async () => {
          await adapter.writeJson("test-array.json", testData.withArray);
          const result = await adapter.readJson<typeof testData.withArray>(
            "test-array.json",
          );

          expect(result.value).toEqual(testData.withArray);
        });

        it("should handle data with special characters", async () => {
          await adapter.writeJson(
            "test-special-chars.json",
            testData.withSpecialChars,
          );
          const result = await adapter.readJson<typeof testData.withSpecialChars>(
            "test-special-chars.json",
          );

          expect(result.value).toEqual(testData.withSpecialChars);
        });

        it("should handle large data", async () => {
          await adapter.writeJson("test-large.json", testData.largeData);
          const result = await adapter.readJson<typeof testData.largeData>(
            "test-large.json",
          );

          expect(result.value).toEqual(testData.largeData);
        });

        it("should overwrite existing data", async () => {
          await adapter.writeJson("test-overwrite.json", { initial: "value" });
          await adapter.writeJson("test-overwrite.json", { updated: "value" });

          const result = await adapter.readJson<{ updated: string }>(
            "test-overwrite.json",
          );
          expect(result.value).toEqual({ updated: "value" });
        });

        it("should handle keys with path separators", async () => {
          const key = "subdir/nested/test.json";
          await adapter.writeJson(key, testData.simple);
          const result = await adapter.readJson<typeof testData.simple>(key);

          expect(result.value).toEqual(testData.simple);
        });
      }

      it("should return { value: null } for missing keys", async () => {
        const result = await adapter.readJson("nonexistent.json");

        expect(result.value).toBeNull();
        // For enabled adapters, no error for missing key
        // For disabled adapters (NullAdapter), also no error
        if (factory.expectEnabled) {
          expect(result.error).toBeUndefined();
        }
      });

      it("should not throw on read operations", async () => {
        // Should never throw, always return result type
        await expect(adapter.readJson("any-key.json")).resolves.toBeDefined();
      });

      it("should not throw on write operations", async () => {
        // Should never throw, always return result type
        await expect(
          adapter.writeJson("any-key.json", { test: true }),
        ).resolves.toBeDefined();
      });
    });

    describe("description property", () => {
      it("should provide a description", () => {
        expect(adapter.description).toBeDefined();
        expect(typeof adapter.description).toBe("string");
      });
    });
  });
}

// InMemoryAdapter-specific tests
describe("InMemoryAdapter-specific features", () => {
  let adapter: InMemoryAdapter;

  beforeEach(() => {
    adapter = new InMemoryAdapter();
  });

  describe("error injection", () => {
    it("should inject read errors", async () => {
      await adapter.writeJson("test.json", { data: "value" });

      const readError = new Error("Simulated read failure");
      adapter.injectError("read", readError);

      const result = await adapter.readJson("test.json");
      expect(result.value).toBeNull();
      expect(result.error).toBe(readError);
    });

    it("should inject write errors", async () => {
      const writeError = new Error("Simulated write failure");
      adapter.injectError("write", writeError);

      const result = await adapter.writeJson("test.json", { data: "value" });
      expect(result.error).toBe(writeError);
    });

    it("should clear errors after they are returned", async () => {
      adapter.injectError("read", new Error("One-time error"));

      // First read returns error
      const result1 = await adapter.readJson("test.json");
      expect(result1.error).toBeDefined();

      // Second read succeeds (returns null for missing key)
      const result2 = await adapter.readJson("test.json");
      expect(result2.error).toBeUndefined();
      expect(result2.value).toBeNull();
    });

    it("should clear all errors with clearErrors()", async () => {
      adapter.injectError("read", new Error("Read error"));
      adapter.injectError("write", new Error("Write error"));

      adapter.clearErrors();

      const readResult = await adapter.readJson("test.json");
      expect(readResult.error).toBeUndefined();

      const writeResult = await adapter.writeJson("test.json", {});
      expect(writeResult.error).toBeUndefined();
    });
  });

  describe("data inspection helpers", () => {
    it("should list stored keys", async () => {
      await adapter.writeJson("key1.json", {});
      await adapter.writeJson("key2.json", {});
      await adapter.writeJson("key3.json", {});

      const keys = adapter.keys();
      expect(keys).toHaveLength(3);
      expect(keys).toContain("key1.json");
      expect(keys).toContain("key2.json");
      expect(keys).toContain("key3.json");
    });

    it("should check key existence", async () => {
      await adapter.writeJson("exists.json", {});

      expect(adapter.has("exists.json")).toBe(true);
      expect(adapter.has("missing.json")).toBe(false);
    });

    it("should clear all data", async () => {
      await adapter.writeJson("key1.json", {});
      await adapter.writeJson("key2.json", {});

      adapter.clear();

      expect(adapter.keys()).toHaveLength(0);
      expect(adapter.has("key1.json")).toBe(false);
    });
  });
});

// FilesystemAdapter-specific tests
describe("FilesystemAdapter-specific features", () => {
  let tmpDir: string;
  let adapter: FilesystemAdapter;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "stagehand-fs-test-"));
    adapter = FilesystemAdapter.create(tmpDir)!;
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should expose the directory path", () => {
    expect(adapter.directory).toBe(tmpDir);
  });

  it("should return null when directory creation fails", () => {
    // Use a path that requires elevated permissions on most systems
    // The null byte in path is universally invalid across OS
    const invalidDir = path.join(os.tmpdir(), "test\x00invalid");
    const result = FilesystemAdapter.create(invalidDir);
    expect(result).toBeNull();
  });

  it("should include path in read error results", async () => {
    // Create a file that's not valid JSON
    const filePath = path.join(tmpDir, "invalid.json");
    fs.writeFileSync(filePath, "not valid json");

    const result = await adapter.readJson("invalid.json");
    expect(result.value).toBeNull();
    expect(result.error).toBeDefined();
    expect(result.path).toBe(filePath);
  });

  it("should create nested directories for keys with paths", async () => {
    const key = "deep/nested/path/data.json";
    await adapter.writeJson(key, { nested: true });

    const fullPath = path.join(tmpDir, key);
    expect(fs.existsSync(fullPath)).toBe(true);
  });

  it("should reject path traversal attempts in readJson", async () => {
    const maliciousKey = "../../../etc/passwd";
    const result = await adapter.readJson(maliciousKey);

    expect(result.value).toBeNull();
    expect(result.error).toBeDefined();
    expect((result.error as Error).message).toContain("path traversal");
  });

  it("should reject path traversal attempts in writeJson", async () => {
    const maliciousKey = "../../../tmp/malicious.json";
    const result = await adapter.writeJson(maliciousKey, { evil: true });

    expect(result.error).toBeDefined();
    expect((result.error as Error).message).toContain("path traversal");
  });

  it("should reject absolute path attempts", async () => {
    const absoluteKey = "/etc/passwd";
    const result = await adapter.readJson(absoluteKey);

    expect(result.value).toBeNull();
    expect(result.error).toBeDefined();
    expect((result.error as Error).message).toContain("path traversal");
  });
});

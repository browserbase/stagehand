/**
 * GCSAdapter Tests
 *
 * Constructor and configuration tests run without mocking.
 * Error handling tests use mocked GCS client to verify behavior without network calls.
 * Integration tests require actual GCS credentials and are gated by environment variables.
 *
 * Environment variables for integration tests:
 * - RUN_GCS_INTEGRATION_TESTS: Set to "true" to enable integration tests
 * - GCS_TEST_BUCKET: GCS bucket name for test data
 * - GCS_CREDENTIALS: (optional) JSON string of service account credentials
 * - GOOGLE_APPLICATION_CREDENTIALS: (optional) Path to service account JSON for ADC
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { GCSAdapter } from "../../../lib/v3/cache/adapters/GCSAdapter";

describe("GCSAdapter", () => {
  describe("constructor", () => {
    it("should create adapter with bucket name", () => {
      const adapter = new GCSAdapter({ bucket: "my-bucket" });

      expect(adapter.enabled).toBe(true);
      expect(adapter.description).toBe("gcs: my-bucket/");
    });

    it("should handle prefix without trailing slash", () => {
      const adapter = new GCSAdapter({ bucket: "my-bucket", prefix: "cache" });

      expect(adapter.description).toBe("gcs: my-bucket/cache/");
    });

    it("should handle prefix with trailing slash", () => {
      const adapter = new GCSAdapter({ bucket: "my-bucket", prefix: "cache/" });

      expect(adapter.description).toBe("gcs: my-bucket/cache/");
    });

    it("should handle empty prefix", () => {
      const adapter = new GCSAdapter({ bucket: "my-bucket", prefix: "" });

      expect(adapter.description).toBe("gcs: my-bucket/");
    });

    it("should accept credentials as object", () => {
      const adapter = new GCSAdapter({
        bucket: "my-bucket",
        credentials: {
          client_email: "test@project.iam.gserviceaccount.com",
          private_key: "-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----\n",
          project_id: "my-project",
        },
      });

      expect(adapter.enabled).toBe(true);
    });

    it("should accept credentials as JSON string", () => {
      const adapter = new GCSAdapter({
        bucket: "my-bucket",
        credentials: JSON.stringify({
          client_email: "test@project.iam.gserviceaccount.com",
          private_key: "-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----\n",
        }),
      });

      expect(adapter.enabled).toBe(true);
    });

    it("should accept credentials as file path", () => {
      const adapter = new GCSAdapter({
        bucket: "my-bucket",
        credentials: "/path/to/credentials.json",
        projectId: "my-project",
      });

      expect(adapter.enabled).toBe(true);
    });

    it("should always report as enabled", () => {
      const adapter = new GCSAdapter({ bucket: "any-bucket" });
      expect(adapter.enabled).toBe(true);
    });
  });

  describe("error handling contract", () => {
    it("should return error result when GCS client fails to initialize", async () => {
      // Mock the dynamic import to throw an error
      vi.doMock("@google-cloud/storage", () => {
        return {
          Storage: class MockStorage {
            constructor() {
              throw new Error("Failed to initialize GCS client");
            }
          },
        };
      });

      // Create a fresh adapter that will use the mocked module
      const { GCSAdapter: FreshGCSAdapter } = await import(
        "../../../lib/v3/cache/adapters/GCSAdapter"
      );
      const adapter = new FreshGCSAdapter({ bucket: "test-bucket" });

      // This should not throw - errors should be returned in the result
      const result = await adapter.readJson("test.json");

      expect(result.value).toBeNull();
      expect(result.error).toBeDefined();

      vi.doUnmock("@google-cloud/storage");
    });

    it("should return error result when GCS download fails", async () => {
      // Mock the GCS client to simulate a download error
      vi.doMock("@google-cloud/storage", () => {
        return {
          Storage: class MockStorage {
            bucket() {
              return {
                file: () => ({
                  download: async () => {
                    throw new Error("Download failed: network error");
                  },
                  save: async () => {
                    throw new Error("Upload failed: network error");
                  },
                }),
              };
            }
          },
        };
      });

      const { GCSAdapter: FreshGCSAdapter } = await import(
        "../../../lib/v3/cache/adapters/GCSAdapter"
      );
      const adapter = new FreshGCSAdapter({ bucket: "test-bucket" });

      const readResult = await adapter.readJson("test.json");
      expect(readResult.value).toBeNull();
      expect(readResult.error).toBeDefined();

      const writeResult = await adapter.writeJson("test.json", { data: true });
      expect(writeResult.error).toBeDefined();

      vi.doUnmock("@google-cloud/storage");
    });

    it("should return null value for 404 errors (file not found)", async () => {
      // Mock the GCS client to simulate a 404 error
      vi.doMock("@google-cloud/storage", () => {
        return {
          Storage: class MockStorage {
            bucket() {
              return {
                file: () => ({
                  download: async () => {
                    const error = new Error("Not Found") as Error & { code: number };
                    error.code = 404;
                    throw error;
                  },
                }),
              };
            }
          },
        };
      });

      const { GCSAdapter: FreshGCSAdapter } = await import(
        "../../../lib/v3/cache/adapters/GCSAdapter"
      );
      const adapter = new FreshGCSAdapter({ bucket: "test-bucket" });

      const result = await adapter.readJson("nonexistent.json");

      // 404 should return null value without error (file simply doesn't exist)
      expect(result.value).toBeNull();
      expect(result.error).toBeUndefined();

      vi.doUnmock("@google-cloud/storage");
    });
  });
});

// Integration tests - only run when explicitly enabled
const runIntegrationTests = process.env.RUN_GCS_INTEGRATION_TESTS === "true";
const testBucket = process.env.GCS_TEST_BUCKET;

describe.skipIf(!runIntegrationTests || !testBucket)(
  "GCSAdapter Integration Tests",
  () => {
    // These tests require real GCS credentials
    // To run: RUN_GCS_INTEGRATION_TESTS=true GCS_TEST_BUCKET=your-bucket vitest run

    let testPrefix: string;

    beforeEach(() => {
      // Use unique prefix for each test run to avoid conflicts
      testPrefix = `stagehand-test-${Date.now()}/`;
    });

    it("should write and read JSON data", async () => {
      const adapter = new GCSAdapter({
        bucket: testBucket!,
        prefix: testPrefix,
      });

      const testData = { key: "value", nested: { data: true } };
      const key = "integration-test.json";

      // Write
      const writeResult = await adapter.writeJson(key, testData);
      expect(writeResult.error).toBeUndefined();

      // Read
      const readResult = await adapter.readJson<typeof testData>(key);
      expect(readResult.value).toEqual(testData);
      expect(readResult.error).toBeUndefined();
    });

    it("should return { value: null } for missing keys", async () => {
      const adapter = new GCSAdapter({
        bucket: testBucket!,
        prefix: testPrefix,
      });

      const result = await adapter.readJson(
        `nonexistent-${Date.now()}-${Math.random()}.json`,
      );

      expect(result.value).toBeNull();
      expect(result.error).toBeUndefined();
    });

    it("should overwrite existing data", async () => {
      const adapter = new GCSAdapter({
        bucket: testBucket!,
        prefix: testPrefix,
      });

      const key = "overwrite-test.json";

      // Write initial data
      await adapter.writeJson(key, { version: 1 });

      // Overwrite
      await adapter.writeJson(key, { version: 2 });

      // Read
      const result = await adapter.readJson<{ version: number }>(key);
      expect(result.value?.version).toBe(2);
    });

    it("should handle nested key paths", async () => {
      const adapter = new GCSAdapter({
        bucket: testBucket!,
        prefix: testPrefix,
      });

      const key = "nested/path/to/file.json";
      const testData = { nested: true };

      await adapter.writeJson(key, testData);
      const result = await adapter.readJson<typeof testData>(key);

      expect(result.value).toEqual(testData);
    });
  },
);

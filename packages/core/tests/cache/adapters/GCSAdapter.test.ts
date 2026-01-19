/**
 * GCSAdapter Tests
 *
 * Constructor and configuration tests run without mocking.
 * Integration tests require actual GCS credentials and are gated by environment variables.
 *
 * Environment variables for integration tests:
 * - RUN_GCS_INTEGRATION_TESTS: Set to "true" to enable integration tests
 * - GCS_TEST_BUCKET: GCS bucket name for test data
 * - GOOGLE_APPLICATION_CREDENTIALS: (optional) Path to service account JSON
 */

import { describe, it, expect, beforeEach } from "vitest";
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

    it("should accept optional credentials", () => {
      const adapter = new GCSAdapter({
        bucket: "my-bucket",
        keyFilename: "/path/to/credentials.json",
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
    it("should not throw from readJson even when GCS client fails to initialize", async () => {
      // GCSAdapter uses lazy initialization, so it won't fail until first operation
      // When it does fail (e.g., missing credentials), it should return an error result
      const adapter = new GCSAdapter({ bucket: "nonexistent-bucket-12345" });

      // This should not throw - errors should be returned in the result
      const result = await adapter.readJson("test.json");

      // Without valid credentials, we expect an error in the result
      expect(result.value).toBeNull();
      // Error could be credential-related or network-related
      expect(result.error).toBeDefined();
    });

    it("should not throw from writeJson even when GCS client fails to initialize", async () => {
      const adapter = new GCSAdapter({ bucket: "nonexistent-bucket-12345" });

      // This should not throw - errors should be returned in the result
      const result = await adapter.writeJson("test.json", { data: true });

      // Without valid credentials, we expect an error in the result
      expect(result.error).toBeDefined();
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

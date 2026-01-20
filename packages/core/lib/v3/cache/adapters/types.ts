import type { ReadJsonResult, WriteJsonResult } from "../../types/private";

/**
 * Interface for pluggable storage backends used by CacheStorage.
 *
 * Implementations should:
 * - Return `{ value: null }` for missing keys (not an error)
 * - Map all errors to `{ error }` result types (never throw)
 * - Handle JSON serialization/deserialization
 *
 * @example FilesystemAdapter - Local filesystem storage (default)
 * @example GCSAdapter - Google Cloud Storage for serverless environments
 * @example NullAdapter - No-op adapter when caching is disabled
 */
export interface StorageAdapter {
  /**
   * Read and parse JSON data from storage.
   * @param key - The storage key (e.g., filename or object path)
   * @returns Parsed JSON value, or `{ value: null }` if not found
   */
  readJson<T>(key: string): Promise<ReadJsonResult<T>>;

  /**
   * Write data as JSON to storage.
   * @param key - The storage key (e.g., filename or object path)
   * @param data - The data to serialize and store
   */
  writeJson(key: string, data: unknown): Promise<WriteJsonResult>;

  /**
   * Whether this adapter is enabled for caching.
   * When false, cache operations become no-ops.
   */
  readonly enabled: boolean;

  /**
   * Optional description of the storage backend (for logging).
   * @example "filesystem: /tmp/cache"
   * @example "gcs: my-bucket/cache-prefix"
   */
  readonly description?: string;
}

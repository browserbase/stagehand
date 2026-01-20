import type { Logger } from "../types/public";
import { ReadJsonResult, WriteJsonResult } from "../types/private";
import type { StorageAdapter } from "./adapters/types";
import { FilesystemAdapter } from "./adapters/FilesystemAdapter";
import { NullAdapter } from "./adapters/NullAdapter";

export interface CacheStorageOptions {
  /**
   * Optional label for logging (e.g., "cache directory").
   */
  label?: string;

  /**
   * Optional custom storage adapter. If provided, cacheDir is ignored.
   */
  adapter?: StorageAdapter;
}

export class CacheStorage {
  private constructor(
    private readonly logger: Logger,
    private readonly adapter: StorageAdapter,
    private readonly dir?: string,
  ) {}

  /**
   * Create a CacheStorage instance.
   *
   * @param cacheDir - The directory path for cache storage (backward compatible).
   *                   Ignored if options.adapter is provided.
   * @param logger - Logger function for error reporting
   * @param options - Additional options including custom adapter
   *
   * @example Using default filesystem adapter (backward compatible)
   * ```typescript
   * const cache = CacheStorage.create("/tmp/cache", logger);
   * ```
   *
   * @example Using a custom adapter
   * ```typescript
   * const adapter = new GCSAdapter({ bucket: "my-bucket" });
   * const cache = CacheStorage.create(undefined, logger, { adapter });
   * ```
   */
  static create(
    cacheDir: string | undefined,
    logger: Logger,
    options?: CacheStorageOptions,
  ): CacheStorage {
    // If a custom adapter is provided, use it directly
    if (options?.adapter) {
      // For custom adapters, we don't have a directory
      // The adapter's description will be used for logging
      return new CacheStorage(logger, options.adapter);
    }

    // Backward compatible: create FilesystemAdapter from cacheDir
    if (!cacheDir) {
      return new CacheStorage(logger, new NullAdapter());
    }

    const filesystemAdapter = FilesystemAdapter.create(cacheDir);
    if (!filesystemAdapter) {
      const label = options?.label ?? "cache directory";
      logger({
        category: "cache",
        message: `unable to initialize ${label}: ${cacheDir}`,
        level: 1,
      });
      return new CacheStorage(logger, new NullAdapter());
    }

    return new CacheStorage(
      logger,
      filesystemAdapter,
      filesystemAdapter.directory,
    );
  }

  /**
   * Get the cache directory path, if using filesystem adapter.
   * @deprecated For backward compatibility only. Use adapter.description instead.
   */
  get directory(): string | undefined {
    return this.dir;
  }

  /**
   * Whether caching is enabled.
   */
  get enabled(): boolean {
    return this.adapter.enabled;
  }

  /**
   * Get the storage adapter (for advanced use cases).
   */
  get storageAdapter(): StorageAdapter {
    return this.adapter;
  }

  async readJson<T>(fileName: string): Promise<ReadJsonResult<T>> {
    return this.adapter.readJson(fileName);
  }

  async writeJson(fileName: string, data: unknown): Promise<WriteJsonResult> {
    return this.adapter.writeJson(fileName, data);
  }
}

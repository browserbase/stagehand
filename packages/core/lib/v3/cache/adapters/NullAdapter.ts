import type { ReadJsonResult, WriteJsonResult } from "../../types/private";
import type { StorageAdapter } from "./types";

/**
 * No-op storage adapter used when caching is disabled.
 *
 * All operations are no-ops:
 * - readJson always returns `{ value: null }`
 * - writeJson always returns `{}`
 *
 * This is used when no cacheDir is provided and no custom adapter is set.
 */
export class NullAdapter implements StorageAdapter {
  readonly enabled: boolean = false;
  readonly description: string = "null (caching disabled)";

  async readJson<T>(): Promise<ReadJsonResult<T>> {
    return { value: null };
  }

  async writeJson(): Promise<WriteJsonResult> {
    return {};
  }
}

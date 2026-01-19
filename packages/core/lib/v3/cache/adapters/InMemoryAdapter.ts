import type { ReadJsonResult, WriteJsonResult } from "../../types/private";
import type { StorageAdapter } from "./types";

/**
 * In-memory storage adapter for testing purposes.
 *
 * Features:
 * - Stores data in a Map for fast access
 * - Supports error injection for testing error handling
 * - Can optionally start disabled
 *
 * @example
 * ```typescript
 * const adapter = new InMemoryAdapter();
 * await adapter.writeJson("key", { foo: "bar" });
 * const result = await adapter.readJson("key");
 * // result.value === { foo: "bar" }
 *
 * // Error injection for testing
 * adapter.injectError("read", new Error("Network timeout"));
 * const errorResult = await adapter.readJson("key");
 * // errorResult.error === Error("Network timeout")
 * ```
 */
export class InMemoryAdapter implements StorageAdapter {
  readonly description: string = "in-memory (test)";

  private readonly data = new Map<string, string>();
  private readError: Error | null = null;
  private writeError: Error | null = null;

  constructor(private readonly isEnabled: boolean = true) {}

  get enabled(): boolean {
    return this.isEnabled;
  }

  /**
   * Inject an error to be returned on the next operation.
   * @param operation - Which operation should fail
   * @param error - The error to return
   */
  injectError(operation: "read" | "write", error: Error): void {
    if (operation === "read") {
      this.readError = error;
    } else {
      this.writeError = error;
    }
  }

  /**
   * Clear any injected errors.
   */
  clearErrors(): void {
    this.readError = null;
    this.writeError = null;
  }

  /**
   * Clear all stored data.
   */
  clear(): void {
    this.data.clear();
  }

  /**
   * Get all stored keys (for testing assertions).
   */
  keys(): string[] {
    return Array.from(this.data.keys());
  }

  /**
   * Check if a key exists (for testing assertions).
   */
  has(key: string): boolean {
    return this.data.has(key);
  }

  async readJson<T>(key: string): Promise<ReadJsonResult<T>> {
    if (this.readError) {
      const error = this.readError;
      this.readError = null;
      return { value: null, error };
    }

    const raw = this.data.get(key);
    if (raw === undefined) {
      return { value: null };
    }

    try {
      return { value: JSON.parse(raw) as T };
    } catch (err) {
      return { value: null, error: err };
    }
  }

  async writeJson(key: string, data: unknown): Promise<WriteJsonResult> {
    if (this.writeError) {
      const error = this.writeError;
      this.writeError = null;
      return { error };
    }

    try {
      this.data.set(key, JSON.stringify(data));
      return {};
    } catch (err) {
      return { error: err };
    }
  }
}

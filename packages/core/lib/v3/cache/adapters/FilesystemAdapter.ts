import fs from "fs";
import path from "path";
import type { ReadJsonResult, WriteJsonResult } from "../../types/private";
import type { StorageAdapter } from "./types";

/**
 * Filesystem-based storage adapter for local development and environments
 * with mounted filesystems.
 *
 * This is the default adapter used by CacheStorage when a cacheDir string is provided.
 */
export class FilesystemAdapter implements StorageAdapter {
  readonly enabled: boolean = true;
  readonly description: string;

  private constructor(private readonly dir: string) {
    this.description = `filesystem: ${dir}`;
  }

  /**
   * Create a FilesystemAdapter, initializing the directory if needed.
   * @param cacheDir - The directory path for cache storage
   * @returns The adapter, or null if directory initialization fails
   */
  static create(cacheDir: string): FilesystemAdapter | null {
    const resolved = path.resolve(cacheDir);
    try {
      fs.mkdirSync(resolved, { recursive: true });
      return new FilesystemAdapter(resolved);
    } catch {
      return null;
    }
  }

  /**
   * Get the resolved directory path.
   */
  get directory(): string {
    return this.dir;
  }

  /**
   * Resolve a key to a file path, ensuring it stays within the cache directory.
   * @throws Error if the key attempts path traversal outside the cache directory
   */
  private resolvePath(key: string): string {
    const resolved = path.resolve(this.dir, key);
    // Prevent path traversal attacks
    // Handle edge case where cacheDir is root (/) - in that case, any absolute path is valid
    const prefix = this.dir === path.sep ? path.sep : this.dir + path.sep;
    if (!resolved.startsWith(prefix) && resolved !== this.dir) {
      throw new Error(
        `Invalid cache key: path traversal detected. Key "${key}" resolves outside cache directory.`,
      );
    }
    return resolved;
  }

  async readJson<T>(key: string): Promise<ReadJsonResult<T>> {
    let filePath: string;
    try {
      filePath = this.resolvePath(key);
    } catch (err) {
      return { value: null, error: err };
    }
    try {
      const raw = await fs.promises.readFile(filePath, "utf8");
      return { value: JSON.parse(raw) as T };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === "ENOENT") {
        return { value: null };
      }
      return { value: null, error: err, path: filePath };
    }
  }

  async writeJson(key: string, data: unknown): Promise<WriteJsonResult> {
    let filePath: string;
    try {
      filePath = this.resolvePath(key);
    } catch (err) {
      return { error: err };
    }
    try {
      await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
      await fs.promises.writeFile(
        filePath,
        JSON.stringify(data, null, 2),
        "utf8",
      );
      return {};
    } catch (err) {
      return { error: err, path: filePath };
    }
  }
}

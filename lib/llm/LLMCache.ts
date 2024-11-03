import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

interface CacheEntry {
  timestamp: number;
  response: any;
  requestId: string;
}

interface CacheStore {
  [key: string]: CacheEntry;
}

export class LLMCache {
  private cacheDir: string;
  private cacheFile: string;
  private logger: (message: {
    category?: string;
    message: string;
    level?: number;
  }) => void;
  private lockFile: string;

  private readonly CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 1 week in milliseconds
  private readonly CLEANUP_PROBABILITY = 0.01; // 1% chance
  private readonly LOCK_TIMEOUT_MS = 1_000;
  private lock_acquired = false;
  private count_lock_acquire_failures = 0;
  private request_id_to_used_hashes: { [key: string]: string[] } = {};

  constructor(
    logger: (message: {
      category?: string;
      message: string;
      level?: number;
    }) => void,
    cacheDir: string = path.join(process.cwd(), "tmp", ".cache"),
    cacheFile: string = "llm_calls.json",
  ) {
    this.logger = logger;
    this.cacheDir = cacheDir;
    this.cacheFile = path.join(cacheDir, cacheFile);
    this.lockFile = path.join(cacheDir, "llm_cache.lock");
    this.ensureCacheDirectory();

    // Handle process exit events (to make sure we release the lock)
    this.setupProcessHandlers();
  }

  private setupProcessHandlers(): void {
    const releaseLockAndExit = () => {
      this.releaseLock();
      process.exit();
    };

    process.on("exit", releaseLockAndExit);
    process.on("SIGINT", releaseLockAndExit);
    process.on("SIGTERM", releaseLockAndExit);
    process.on("uncaughtException", (err) => {
      this.logger({
        category: "llm_cache",
        message: `Uncaught exception: ${err}`,
        level: 2,
      });
      if (this.lock_acquired) {
        releaseLockAndExit();
      }
    });
  }

  private ensureCacheDirectory(): void {
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  private createHash(data: any): string {
    const hash = crypto.createHash("sha256");
    return hash.update(JSON.stringify(data)).digest("hex");
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async acquireLock(): Promise<boolean> {
    const startTime = Date.now();
    while (Date.now() - startTime < this.LOCK_TIMEOUT_MS) {
      try {
        if (fs.existsSync(this.lockFile)) {
          const lockAge = Date.now() - fs.statSync(this.lockFile).mtimeMs;
          if (lockAge > this.LOCK_TIMEOUT_MS) {
            fs.unlinkSync(this.lockFile);
          }
        }

        fs.writeFileSync(this.lockFile, process.pid.toString(), { flag: "wx" });
        this.count_lock_acquire_failures = 0;
        this.lock_acquired = true;
        return true;
      } catch (error) {
        await this.sleep(5);
      }
    }
    this.logger({
      category: "llm_cache",
      message: "Failed to acquire lock after timeout",
      level: 2,
    });
    this.count_lock_acquire_failures++;
    if (this.count_lock_acquire_failures >= 3) {
      this.logger({
        category: "llm_cache",
        message:
          "Failed to acquire lock 3 times in a row. Releasing lock manually.",
        level: 1,
      });
      this.releaseLock();
    }
    return false;
  }

  private releaseLock(): void {
    try {
      if (fs.existsSync(this.lockFile)) {
        fs.unlinkSync(this.lockFile);
      }
      this.lock_acquired = false;
    } catch (error) {
      this.logger({
        category: "llm_cache",
        message: `Error releasing lock: ${error}`,
        level: 2,
      });
    }
  }

  private readCache(): CacheStore {
    if (fs.existsSync(this.cacheFile)) {
      return JSON.parse(fs.readFileSync(this.cacheFile, "utf-8"));
    }

    return {};
  }

  private writeCache(cache: CacheStore): void {
    try {
      if (Math.random() < this.CLEANUP_PROBABILITY) {
        this.cleanupStaleEntries(cache);
      }
      fs.writeFileSync(this.cacheFile, JSON.stringify(cache, null, 2));
    } finally {
      this.releaseLock();
    }
  }

  private cleanupStaleEntries(cache: CacheStore): void {
    if (!this.acquireLock()) {
      this.logger({
        category: "llm_cache",
        message: "Failed to acquire lock for cleaning up cache",
        level: 2,
      });
      return;
    }

    try {
      const now = Date.now();
      let entriesRemoved = 0;

      for (const [hash, entry] of Object.entries(cache)) {
        if (now - entry.timestamp > this.CACHE_MAX_AGE_MS) {
          delete cache[hash];
          entriesRemoved++;
        }
      }

      if (entriesRemoved > 0) {
        this.logger({
          category: "llm_cache",
          message: `Cleaned up ${entriesRemoved} stale cache entries`,
          level: 1,
        });
      }
    } catch (error) {
      this.logger({
        category: "llm_cache",
        message: `Error cleaning up stale cache entries: ${error}`,
        level: 1,
      });
    } finally {
      this.releaseLock();
    }
  }

  resetCache(): void {
    if (!this.acquireLock()) {
      this.logger({
        category: "llm_cache",
        message: "Failed to acquire lock for resetting cache",
        level: 2,
      });
      return;
    }

    try {
      this.ensureCacheDirectory();
      fs.writeFileSync(this.cacheFile, "{}");
    } finally {
      this.releaseLock();
    }
  }

  async get(options: any, requestId: string): Promise<any | null> {
    if (!(await this.acquireLock())) {
      this.logger({
        category: "llm_cache",
        message: "Failed to acquire lock for getting cache",
        level: 2,
      });
      return null;
    }

    try {
      const hash = this.createHash(options);
      const cache = this.readCache();

      if (cache[hash]) {
        this.logger({
          category: "llm_cache",
          message: "Cache hit",
          level: 1,
        });
        this.request_id_to_used_hashes[requestId] ??= [];
        this.request_id_to_used_hashes[requestId].push(hash);
        return cache[hash].response;
      }
      return null;
    } catch (error) {
      this.logger({
        category: "llm_cache",
        message: `Error getting cache: ${error}. Resetting cache.`,
        level: 1,
      });

      this.resetCache();
      return null;
    } finally {
      this.releaseLock();
    }
  }

  async deleteCacheForRequestId(requestId: string): Promise<void> {
    if (!(await this.acquireLock())) {
      this.logger({
        category: "llm_cache",
        message: "Failed to acquire lock for deleting cache",
        level: 2,
      });
      return;
    }

    try {
      const cache = this.readCache();

      let entriesRemoved = [];
      for (const hash of this.request_id_to_used_hashes[requestId] ?? []) {
        if (cache[hash]) {
          entriesRemoved.push(cache[hash]);
          delete cache[hash];
        }
      }

      this.logger({
        category: "llm_cache",
        message: `Deleted ${entriesRemoved.length} cache entries for requestId ${requestId}`,
        level: 1,
      });

      this.writeCache(cache);
    } catch (exception) {
      this.logger({
        category: "llm_cache",
        message: `Error deleting cache for requestId ${requestId}: ${exception}`,
        level: 1,
      });
    } finally {
      this.releaseLock();
    }
  }

  async set(options: any, response: any, requestId: string): Promise<void> {
    if (!(await this.acquireLock())) {
      this.logger({
        category: "llm_cache",
        message: "Failed to acquire lock for setting cache",
        level: 2,
      });
      return;
    }

    try {
      const hash = this.createHash(options);
      const cache = this.readCache();
      cache[hash] = {
        response: response,
        timestamp: Date.now(),
        requestId,
      };

      this.writeCache(cache);
      this.request_id_to_used_hashes[requestId] ??= [];
      this.request_id_to_used_hashes[requestId].push(hash);
      this.logger({
        category: "llm_cache",
        message: "Cache miss - saved new response",
        level: 1,
      });
    } catch (error) {
      this.logger({
        category: "llm_cache",
        message: `Error setting cache: ${error}. Resetting cache.`,
        level: 1,
      });

      this.resetCache();
    } finally {
      this.releaseLock();
    }
  }
}

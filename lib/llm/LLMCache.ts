import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

interface CacheEntry {
  timestamp: number;
  data: any;
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

  private readonly CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 1 week in milliseconds
  private readonly CLEANUP_PROBABILITY = 0.01; // 1% chance

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
    this.ensureCacheDirectory();
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

  private readCache(): CacheStore {
    if (fs.existsSync(this.cacheFile)) {
      return JSON.parse(fs.readFileSync(this.cacheFile, "utf-8"));
    }
    return {};
  }

  private writeCache(cache: CacheStore): void {
    if (Math.random() < this.CLEANUP_PROBABILITY) {
      this.cleanupStaleEntries(cache);
    }
    fs.writeFileSync(this.cacheFile, JSON.stringify(cache, null, 2));
  }

  private cleanupStaleEntries(cache: CacheStore): void {
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
  }

  private resetCache(): void {
    this.ensureCacheDirectory();
    fs.writeFileSync(this.cacheFile, "{}");
  }

  get(options: any): any | null {
    try {
      const hash = this.createHash(options);
      const cache = this.readCache();

      if (cache[hash]) {
        this.logger({
          category: "llm_cache",
          message: "Cache hit",
          level: 1,
        });
        return cache[hash];
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
    }
  }

  set(options: any, response: any): void {
    try {
      const hash = this.createHash(options);
      const cache = this.readCache();
      cache[hash] = response;
      this.writeCache(cache);
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
    }
  }
}

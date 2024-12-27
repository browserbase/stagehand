import { BaseCache, CacheEntry } from "./BaseCache";

export class LLMCache extends BaseCache<CacheEntry> {
  constructor(
    logger: (message: {
      category?: string;
      message: string;
      level?: number;
    }) => void,
    cacheDir?: string,
    cacheFile?: string,
  ) {
    super(logger, cacheDir, cacheFile || "llm_calls.json");
  }

  /**
   * Overrides the get method to track used hashes by requestId.
   * @param options - The options used to generate the cache key.
   * @param requestId - The identifier for the current request.
   * @returns The cached data if available, otherwise null.
   */
  public async get<T>(
    options: Record<string, unknown>,
    requestId: string,
  ): Promise<T | null> {
    const data = await super.get(options, requestId);
    if (data && typeof data === 'object') {
      // Ensure token usage is preserved in cached responses
      if ('_stagehandTokenUsage' in data) {
        this.logger({
          category: "llm_cache",
          message: "Cache hit with token usage data",
          level: 1,
          auxiliary: {
            token_usage: {
              value: JSON.stringify(data._stagehandTokenUsage),
              type: "object",
            },
          },
        });
      } else {
        // Add default token usage for cached responses without it
        (data as any)._stagehandTokenUsage = {
          functionName: options.functionName as string || "unknown",
          modelName: "cached",
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          timestamp: Date.now(),
        };
      }
    }
    return data as T | null;
  }

  /**
   * Overrides the set method to include cache cleanup logic.
   * @param options - The options used to generate the cache key.
   * @param data - The data to be cached.
   * @param requestId - The identifier for the current request.
   */
  public async set(
    options: Record<string, unknown>,
    data: unknown,
    requestId: string,
  ): Promise<void> {
    // Ensure data has token usage before caching
    if (data && typeof data === 'object') {
      if (!('_stagehandTokenUsage' in data)) {
        (data as any)._stagehandTokenUsage = {
          functionName: options.functionName as string || "unknown",
          modelName: "cached",
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          timestamp: Date.now(),
        };
      }
    }
    await super.set(options, data, requestId);
    this.logger({
      category: "llm_cache",
      message: "Cache miss - saved new response",
      level: 1,
      auxiliary: {
        token_usage: data && typeof data === 'object' && '_stagehandTokenUsage' in data
          ? {
              value: JSON.stringify((data as any)._stagehandTokenUsage),
              type: "object",
            }
          : undefined,
      },
    });
  }
}

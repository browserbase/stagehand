import { describe, expect, it, vi } from "vitest";
import { ActCache } from "../lib/v3/cache/ActCache";
import type { CacheStorage } from "../lib/v3/cache/CacheStorage";
import type { ActHandler } from "../lib/v3/handlers/actHandler";
import type { LLMClient } from "../lib/v3/llm/LLMClient";
import type { Page } from "../lib/v3/understudy/page";
import type { ActCacheContext, CachedActEntry } from "../lib/v3/types/private";
import type { Action } from "../lib/v3/types/public";

function createFakeStorage<T>(entry: T): CacheStorage {
  return {
    enabled: true,
    readJson: vi.fn().mockResolvedValue({ value: entry }),
    writeJson: vi.fn().mockResolvedValue({}),
    directory: "/tmp/cache",
  } as unknown as CacheStorage;
}

describe("ActCache variable handling", () => {
  it("cache key includes variable keys but not values", async () => {
    const storage = {
      enabled: true,
      readJson: vi.fn(),
      writeJson: vi.fn().mockResolvedValue({}),
      directory: "/tmp/cache",
    } as unknown as CacheStorage;

    const cache = new ActCache({
      storage,
      logger: vi.fn(),
      getActHandler: () => null as unknown as ActHandler,
      getDefaultLlmClient: () => ({} as LLMClient),
      domSettleTimeoutMs: undefined,
    });

    const fakePage = {
      url: vi.fn().mockResolvedValue("https://example.com"),
    } as unknown as Page;

    // First context with username="user1@example.com"
    const context1 = await cache.prepareContext(
      "type %username% into the email field",
      fakePage,
      { username: "user1@example.com" }
    );

    // Second context with username="user2@example.com"
    const context2 = await cache.prepareContext(
      "type %username% into the email field",
      fakePage,
      { username: "user2@example.com" }
    );

    // Third context with different variable key name
    const context3 = await cache.prepareContext(
      "type %email% into the email field",
      fakePage,
      { email: "user3@example.com" }
    );

    // Same instruction + same variable keys = same cache key
    expect(context1?.cacheKey).toBe(context2?.cacheKey);

    // Different variable keys = different cache key
    expect(context1?.cacheKey).not.toBe(context3?.cacheKey);

    // Verify variable keys are sorted and stored
    expect(context1?.variableKeys).toEqual(["username"]);
    expect(context2?.variableKeys).toEqual(["username"]);
    expect(context3?.variableKeys).toEqual(["email"]);

    // Verify variable values are preserved in context
    expect(context1?.variables).toEqual({ username: "user1@example.com" });
    expect(context2?.variables).toEqual({ username: "user2@example.com" });
  });

  it("replays cached actions with variable substitution", async () => {
    // Cached action contains variable placeholder %username%
    const action: Action = {
      selector: "xpath=/html/body/input[@type='email']",
      description: "type username into email field",
      method: "type",
      arguments: ["%username%"], // Variable placeholder
    };

    const entry: CachedActEntry = {
      version: 1,
      instruction: "type %username% into the email field",
      url: "https://example.com",
      variableKeys: ["username"],
      actions: [action],
      actionDescription: "type username",
      message: "done",
    };

    const storage = createFakeStorage(entry);

    // Track what variables are passed to takeDeterministicAction
    const capturedVariables: Record<string, string>[] = [];
    const handler = {
      takeDeterministicAction: vi.fn().mockImplementation(
        async (_action, _page, _timeout, _client, _ensure, variables) => {
          capturedVariables.push(variables || {});
          return {
            success: true,
            message: "ok",
            actionDescription: "type username",
            actions: [action],
          };
        }
      ),
    } as unknown as ActHandler;

    const defaultClient = {} as LLMClient;

    const cache = new ActCache({
      storage,
      logger: vi.fn(),
      getActHandler: () => handler,
      getDefaultLlmClient: () => defaultClient,
      domSettleTimeoutMs: undefined,
    });

    // First replay with username="user1@example.com"
    const context1: ActCacheContext = {
      instruction: "type %username% into the email field",
      cacheKey: "test-key",
      pageUrl: "https://example.com",
      variableKeys: ["username"],
      variables: { username: "user1@example.com" },
    };

    const result1 = await cache.tryReplay(context1, {} as Page);

    expect(result1?.success).toBe(true);
    expect(handler.takeDeterministicAction).toHaveBeenCalledTimes(1);
    expect(capturedVariables[0]).toEqual({ username: "user1@example.com" });

    // Reset
    vi.clearAllMocks();
    capturedVariables.length = 0;

    // Second replay with username="user2@example.com"
    const context2: ActCacheContext = {
      instruction: "type %username% into the email field",
      cacheKey: "test-key", // Same cache key!
      pageUrl: "https://example.com",
      variableKeys: ["username"],
      variables: { username: "user2@example.com" },
    };

    const result2 = await cache.tryReplay(context2, {} as Page);

    expect(result2?.success).toBe(true);
    expect(handler.takeDeterministicAction).toHaveBeenCalledTimes(1);
    expect(capturedVariables[0]).toEqual({ username: "user2@example.com" });
  });

  it("cache miss when variable keys don't match", async () => {
    const action: Action = {
      selector: "xpath=/html/body/input",
      description: "type username",
      method: "type",
      arguments: ["%username%"],
    };

    // Cached entry expects "username" variable
    const entry: CachedActEntry = {
      version: 1,
      instruction: "type %username% into the field",
      url: "https://example.com",
      variableKeys: ["username"],
      actions: [action],
    };

    const storage = createFakeStorage(entry);
    const cache = new ActCache({
      storage,
      logger: vi.fn(),
      getActHandler: () => null as unknown as ActHandler,
      getDefaultLlmClient: () => ({} as LLMClient),
      domSettleTimeoutMs: undefined,
    });

    // Context has different variable key "email"
    const context: ActCacheContext = {
      instruction: "type %email% into the field",
      cacheKey: "test-key",
      pageUrl: "https://example.com",
      variableKeys: ["email"],
      variables: { email: "test@example.com" },
    };

    const result = await cache.tryReplay(context, {} as Page);

    // Should return null (cache miss) due to variable key mismatch
    expect(result).toBeNull();
  });

  it("cache miss when required variables are missing", async () => {
    const action: Action = {
      selector: "xpath=/html/body/input",
      description: "type username",
      method: "type",
      arguments: ["%username%"],
    };

    const entry: CachedActEntry = {
      version: 1,
      instruction: "type %username% into the field",
      url: "https://example.com",
      variableKeys: ["username"],
      actions: [action],
    };

    const storage = createFakeStorage(entry);
    const logger = vi.fn();
    const cache = new ActCache({
      storage,
      logger,
      getActHandler: () => null as unknown as ActHandler,
      getDefaultLlmClient: () => ({} as LLMClient),
      domSettleTimeoutMs: undefined,
    });

    // Context missing the username variable value
    const context: ActCacheContext = {
      instruction: "type %username% into the field",
      cacheKey: "test-key",
      pageUrl: "https://example.com",
      variableKeys: ["username"],
      variables: {}, // Missing username value!
    };

    const result = await cache.tryReplay(context, {} as Page);

    // Should return null (cache miss)
    expect(result).toBeNull();

    // Should log the miss reason
    expect(logger).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "cache",
        message: "act cache miss: missing variables for replay",
        level: 2,
      })
    );
  });

  it("handles multiple variables correctly", async () => {
    const storage = {
      enabled: true,
      readJson: vi.fn(),
      writeJson: vi.fn().mockResolvedValue({}),
      directory: "/tmp/cache",
    } as unknown as CacheStorage;

    const cache = new ActCache({
      storage,
      logger: vi.fn(),
      getActHandler: () => null as unknown as ActHandler,
      getDefaultLlmClient: () => ({} as LLMClient),
      domSettleTimeoutMs: undefined,
    });

    const fakePage = {
      url: vi.fn().mockResolvedValue("https://example.com"),
    } as unknown as Page;

    // Context with multiple variables
    const context1 = await cache.prepareContext(
      "fill %username% and %password%",
      fakePage,
      { username: "user1", password: "pass1" }
    );

    const context2 = await cache.prepareContext(
      "fill %username% and %password%",
      fakePage,
      { username: "user2", password: "pass2" }
    );

    // Same cache key despite different values
    expect(context1?.cacheKey).toBe(context2?.cacheKey);

    // Variable keys should be sorted
    expect(context1?.variableKeys).toEqual(["password", "username"]);
    expect(context2?.variableKeys).toEqual(["password", "username"]);
  });
});

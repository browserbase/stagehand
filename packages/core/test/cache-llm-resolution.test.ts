import { describe, expect, it, vi } from "vitest";
import { ActCache } from "../lib/v3/cache/ActCache";
import { AgentCache } from "../lib/v3/cache/AgentCache";
import type { CacheStorage } from "../lib/v3/cache/CacheStorage";
import type { ActHandler } from "../lib/v3/handlers/actHandler";
import type { LLMClient } from "../lib/v3/llm/LLMClient";
import type { Page } from "../lib/v3/understudy/page";
import type { V3Context } from "../lib/v3/understudy/context";
import type {
  ActCacheContext,
  CachedActEntry,
  CachedAgentEntry,
  AgentCacheContext,
  AgentReplayActStep,
} from "../lib/v3/types/private";
import type {
  Action,
  AgentResult,
  AvailableModel,
} from "../lib/v3/types/public";

function createFakeStorage<T>(entry: T): CacheStorage {
  return {
    enabled: true,
    readJson: vi.fn().mockResolvedValue({ value: entry }),
    writeJson: vi.fn().mockResolvedValue({}),
    directory: "/tmp/cache",
  } as unknown as CacheStorage;
}

describe("Cache LLM client selection", () => {
  it("ActCache uses provided override client during replay", async () => {
    const action: Action = {
      selector: "xpath=/html/body/button",
      description: "click button",
      method: "click",
      arguments: [],
    };

    const entry: CachedActEntry = {
      version: 1,
      instruction: "click button",
      url: "https://example.com",
      variableKeys: [],
      actions: [action],
      actionDescription: "click button",
      message: "done",
    };

    const storage = createFakeStorage(entry);
    const handler = {
      takeDeterministicAction: vi.fn().mockResolvedValue({
        success: true,
        message: "ok",
        actionDescription: "click button",
        actions: [action],
      }),
    } as unknown as ActHandler;
    const defaultClient = { id: "default" } as unknown as LLMClient;
    const overrideClient = { id: "override" } as unknown as LLMClient;

    const cache = new ActCache({
      storage,
      logger: vi.fn(),
      getActHandler: () => handler,
      getDefaultLlmClient: () => defaultClient,
      domSettleTimeoutMs: undefined,
    });

    const context: ActCacheContext = {
      instruction: "click button",
      cacheKey: "abc",
      pageUrl: "https://example.com",
      variableKeys: [],
      variables: undefined,
    };

    const result = await cache.tryReplay(
      context,
      {} as Page,
      undefined,
      overrideClient,
    );

    expect(result?.success).toBe(true);
    expect(handler.takeDeterministicAction).toHaveBeenCalledTimes(1);
    const call = vi.mocked(handler.takeDeterministicAction).mock.calls[0];
    expect(call?.[3]).toBe(overrideClient);
  });

  it("AgentCache uses provided override client during replay", async () => {
    const action: Action = {
      selector: "xpath=/html/body/input",
      description: "type email",
      method: "type",
      arguments: ["test@example.com"],
    };

    const agentStep: AgentReplayActStep = {
      type: "act",
      instruction: "type email",
      actions: [action],
    };

    const entry: CachedAgentEntry = {
      version: 1,
      instruction: "fill form",
      startUrl: "https://example.com",
      options: {},
      configSignature: "sig",
      steps: [agentStep],
      result: { success: true, actions: [] } as AgentResult,
      timestamp: new Date().toISOString(),
    };

    const storage = {
      enabled: true,
      readJson: vi.fn().mockImplementation(async () => ({ value: entry })),
      writeJson: vi.fn().mockResolvedValue({}),
      directory: "/tmp/cache",
    } as unknown as CacheStorage;

    const handler = {
      takeDeterministicAction: vi.fn().mockResolvedValue({
        success: true,
        message: "ok",
        actionDescription: "type email",
        actions: [action],
      }),
    } as unknown as ActHandler;

    const fakePage = {} as Page;
    const ctx = {
      awaitActivePage: vi.fn().mockResolvedValue(fakePage),
    } as unknown as V3Context;

    const defaultClient = { id: "default-agent" } as unknown as LLMClient;
    const overrideClient = { id: "override-agent" } as unknown as LLMClient;

    const cache = new AgentCache({
      storage,
      logger: vi.fn(),
      getActHandler: () => handler,
      getContext: () => ctx,
      getDefaultLlmClient: () => defaultClient,
      getBaseModelName: () => "openai/gpt-4.1-mini" as AvailableModel,
      getSystemPrompt: () => undefined,
      domSettleTimeoutMs: undefined,
      act: vi.fn(),
    });

    const context: AgentCacheContext = {
      instruction: "fill form",
      startUrl: "https://example.com",
      options: {},
      configSignature: "sig",
      cacheKey: "agent-key",
    };

    const result = await cache.tryReplay(context, overrideClient);

    expect(result?.success).toBe(true);
    expect(handler.takeDeterministicAction).toHaveBeenCalledTimes(1);
    const call = vi.mocked(handler.takeDeterministicAction).mock.calls[0];
    expect(call?.[3]).toBe(overrideClient);
  });

  it("AgentCache replays non-act steps without requiring an override client", async () => {
    const gotoEntry: CachedAgentEntry = {
      version: 1,
      instruction: "navigate home",
      startUrl: "https://example.com/source",
      options: {},
      configSignature: "sig",
      steps: [
        {
          type: "goto",
          url: "https://example.com/target",
          waitUntil: "load",
        },
      ],
      result: { success: true, actions: [] } as AgentResult,
      timestamp: new Date().toISOString(),
    };

    const storage = {
      enabled: true,
      readJson: vi.fn().mockResolvedValue({ value: gotoEntry }),
      writeJson: vi.fn().mockResolvedValue({}),
      directory: "/tmp/cache",
    } as unknown as CacheStorage;

    const handler = {
      takeDeterministicAction: vi.fn(),
    } as unknown as ActHandler;

    const fakePage = { goto: vi.fn() } as unknown as Page;
    const ctx = {
      awaitActivePage: vi.fn().mockResolvedValue(fakePage),
    } as unknown as V3Context;

    const cache = new AgentCache({
      storage,
      logger: vi.fn(),
      getActHandler: () => handler,
      getContext: () => ctx,
      getDefaultLlmClient: () => ({ id: "default" }) as unknown as LLMClient,
      getBaseModelName: () => "openai/gpt-4.1-mini" as AvailableModel,
      getSystemPrompt: () => undefined,
      domSettleTimeoutMs: undefined,
      act: vi.fn(),
    });

    const context: AgentCacheContext = {
      instruction: "navigate home",
      startUrl: "https://example.com/source",
      options: {},
      configSignature: "sig",
      cacheKey: "agent-goto",
    };

    const result = await cache.tryReplay(context);

    expect(result?.success).toBe(true);
    expect(handler.takeDeterministicAction).not.toHaveBeenCalled();
    expect(fakePage.goto).toHaveBeenCalledWith("https://example.com/target", {
      waitUntil: "load",
    });
  });
});

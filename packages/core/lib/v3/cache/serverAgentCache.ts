import { AgentCache } from "./AgentCache.js";
import { CacheStorage } from "./CacheStorage.js";
import type { V3 } from "../v3.js";
import type { AgentCacheTransferPayload } from "../types/private/index.js";
import type { ActHandler } from "../handlers/actHandler.js";
import type { V3Context } from "../understudy/context.js";
import type { AvailableModel, V3Options } from "../types/public/index.js";
import type { ModelConfiguration } from "../types/public/model.js";
import type { LLMClient } from "../llm/LLMClient.js";

export interface ServerAgentCacheHandle {
  complete(): AgentCacheTransferPayload | null;
  discard(): void;
}

// TODO (refactor-caching): this reflective access is a known temporary escape hatch.
// Once the caching internals are reworked, replace it with proper V3 helpers so
// we stop poking private fields from the outside.
function getInternalField<T>(instance: V3, key: string): T {
  return (instance as unknown as Record<string, unknown>)[key] as T;
}

function setInternalField(instance: V3, key: string, value: unknown): void {
  (instance as unknown as Record<string, unknown>)[key] = value;
}

function createMemoryAgentCache(stagehand: V3): AgentCache {
  const resolveLlmClient = getInternalField<
    (model?: ModelConfiguration) => LLMClient
  >(stagehand, "resolveLlmClient");

  return new AgentCache({
    storage: CacheStorage.createMemory(stagehand.logger),
    logger: stagehand.logger,
    getActHandler: () =>
      getInternalField<ActHandler | null>(stagehand, "actHandler"),
    getContext: () => getInternalField<V3Context | null>(stagehand, "ctx"),
    getDefaultLlmClient: () => resolveLlmClient.call(stagehand),
    getBaseModelName: () =>
      getInternalField<AvailableModel>(stagehand, "modelName"),
    getSystemPrompt: () =>
      getInternalField<V3Options>(stagehand, "opts").systemPrompt,
    domSettleTimeoutMs: getInternalField<number | undefined>(
      stagehand,
      "domSettleTimeoutMs",
    ),
    act: stagehand.act.bind(stagehand),
    bufferLatestEntry: true,
  });
}

export function __internalCreateInMemoryAgentCacheHandle(
  stagehand: V3,
): ServerAgentCacheHandle {
  const originalCache = getInternalField<AgentCache>(stagehand, "agentCache");
  const memoryCache = createMemoryAgentCache(stagehand);

  setInternalField(stagehand, "agentCache", memoryCache);
  let restored = false;
  const restore = () => {
    if (!restored) {
      setInternalField(stagehand, "agentCache", originalCache);
      restored = true;
    }
  };

  return {
    complete: () => {
      const entry = memoryCache.consumeBufferedEntry();
      restore();
      return entry;
    },
    discard: () => {
      restore();
    },
  };
}

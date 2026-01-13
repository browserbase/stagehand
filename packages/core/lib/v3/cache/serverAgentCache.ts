import { AgentCache } from "./AgentCache";
import { CacheStorage } from "./CacheStorage";
import type { V3 } from "../v3";
import type { AgentCacheTransferPayload } from "../types/private";
import type { ActHandler } from "../handlers/actHandler";
import type { V3Context } from "../understudy/context";
import type { AvailableModel, V3Options } from "../types/public";
import type { ModelConfiguration } from "../types/public/model";
import type { LLMClient } from "../llm/LLMClient";

export interface ServerAgentCacheHandle {
  complete(): AgentCacheTransferPayload | null;
  discard(): void;
}

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

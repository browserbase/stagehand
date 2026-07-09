import type { ActOptions, ActResult, Action } from "../public/index.js";
import { CacheStorage } from "../../cache/CacheStorage.js";
import type { ActHandler } from "../../handlers/actHandler.js";
import type { LLMClient } from "../../llm/LLMClient.js";
import type { Logger } from "./logger.js";

export type ActFn = (instruction: string, options?: ActOptions) => Promise<ActResult>;

export type ActCacheContext = {
  instruction: string;
  cacheKey: string;
  pageUrl: string;
  variableKeys: string[];
  variables?: Record<string, string>;
};

export type ActCacheDeps = {
  storage: CacheStorage;
  logger: Logger;
  getActHandler: () => ActHandler | null;
  getDefaultLlmClient: () => LLMClient;
  domSettleTimeoutMs?: number;
};

export type ReadJsonResult<T> = {
  value: T | null;
  path?: string;
  error?: unknown;
};

export type WriteJsonResult = {
  path?: string;
  error?: unknown;
};

export interface CachedActEntry {
  version: 1;
  instruction: string;
  url: string;
  variableKeys: string[];
  actions: Action[];
  actionDescription?: string;
  message?: string;
}

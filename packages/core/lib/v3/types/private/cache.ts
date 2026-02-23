import type {
  ActOptions,
  ActResult,
  AvailableModel,
  Logger,
  AgentResult,
  Action,
  LoadState,
} from "../public/index.js";
import { CacheStorage } from "../../cache/CacheStorage.js";
import type { ActHandler } from "../../handlers/actHandler.js";
import type { V3Context } from "../../understudy/context.js";
import type { LLMClient } from "../../llm/LLMClient.js";

export type ActFn = (
  instruction: string,
  options?: ActOptions,
) => Promise<ActResult>;

export type AgentCacheContext = {
  instruction: string;
  startUrl: string;
  options: SanitizedAgentExecuteOptions;
  configSignature: string;
  cacheKey: string;
  variableKeys: string[] /** Variable keys used in this execution (for cache key) */;
  /** Variable values to substitute during replay */
  variables?: Record<string, string>;
};

export type AgentCacheTransferPayload = {
  cacheKey: string;
  entry: CachedAgentEntry;
};

export type AgentCacheDeps = {
  storage: CacheStorage;
  logger: Logger;
  getActHandler: () => ActHandler | null;
  getContext: () => V3Context | null;
  getDefaultLlmClient: () => LLMClient;
  getBaseModelName: () => AvailableModel;
  getSystemPrompt: () => string | undefined;
  domSettleTimeoutMs?: number;
  act: ActFn;
  bufferLatestEntry?: boolean;
};

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

export type AgentReplayStep =
  | AgentReplayActStep
  | AgentReplayFillFormStep
  | AgentReplayGotoStep
  | AgentReplayScrollStep
  | AgentReplayWaitStep
  | AgentReplayNavBackStep
  | AgentReplayKeysStep
  | { type: string; [key: string]: unknown };

export interface AgentReplayActStep {
  type: "act";
  instruction: string;
  actions?: Action[];
  actionDescription?: string;
  message?: string;
  timeout?: number;
}

export interface AgentReplayFillFormStep {
  type: "fillForm";
  fields?: Array<{ action: string; value: string }>;
  observeResults?: Action[];
  actions?: Action[];
}

export interface AgentReplayGotoStep {
  type: "goto";
  url: string;
  waitUntil?: LoadState;
}

export interface AgentReplayScrollStep {
  type: "scroll";
  deltaX?: number;
  deltaY?: number;
  anchor?: { x: number; y: number };
}

export interface AgentReplayWaitStep {
  type: "wait";
  timeMs: number;
}

export interface AgentReplayNavBackStep {
  type: "navback";
  waitUntil?: LoadState;
}

export interface AgentReplayKeysStep {
  type: "keys";
  instruction?: string;
  playwrightArguments: {
    method: "type" | "press";
    text?: string;
    keys?: string;
    times?: number;
  };
}

export interface SanitizedAgentExecuteOptions {
  maxSteps?: number;
  highlightCursor?: boolean;
}

export interface CachedAgentEntry {
  version: 1;
  instruction: string;
  startUrl: string;
  options: SanitizedAgentExecuteOptions;
  configSignature: string;
  steps: AgentReplayStep[];
  result: AgentResult;
  timestamp: string;
}

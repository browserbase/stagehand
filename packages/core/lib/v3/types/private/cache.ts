import type {
  ActOptions,
  ActResult,
  AvailableModel,
  Logger,
  AgentResult,
  Action,
  LoadState,
} from "../public";
import { CacheStorage } from "../../cache/CacheStorage";
import type { ActHandler } from "../../handlers/actHandler";
import type { V3Context } from "../../understudy/context";
import type { LLMClient } from "../../llm/LLMClient";

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
};

export type ActCacheContext = {
  instruction: string;
  cacheKey: string;
  pageUrl: string;
  variables: Record<string, string>;
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
  variables: Record<string, string>;
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

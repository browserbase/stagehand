import type { AgentResult } from "@/lib/v3/types/agent";
import type { Action } from "@/lib/v3/types/methods";
import type { LoadState } from "@/lib/v3/types";

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
  autoScreenshot?: boolean;
  waitBetweenActions?: number;
  context?: string;
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

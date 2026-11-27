import type {
  Action,
  ActResultData,
  LLMGenerateParams,
  LLMGenerateResult,
  Variables,
} from "@browserbasehq/stagehand-protocol/types";
import type { z } from "zod/v4";
import type { StagehandLogger } from "../../logger.js";
import type { Page } from "../../understudy/page.js";
import type { Progress } from "../../understudy/progress.js";

export type SnapshotOptions = Parameters<Page["captureSnapshot"]>[0];

export type InferenceUsage = {
  prompt_tokens: number;
  completion_tokens: number;
  reasoning_tokens: number;
  cached_input_tokens: number;
  inference_time_ms: number;
};

export type LlmPort = {
  generate: (params: LLMGenerateParams) => Promise<LLMGenerateResult>;
  record: (usage: InferenceUsage) => void;
  systemPrompt: string;
};

export type Abstained = {
  kind: "abstained";
  reason: string;
};

export type ActRequest = {
  instruction: string;
  variables?: Variables;
  page: Page;
  snapshotOptions: SnapshotOptions;
  settled: Promise<void>;
  progress: Progress;
  ensureTimeRemaining: () => void;
  logger: StagehandLogger;
  llm: LlmPort;
  runAction: (action: Action, options?: { selfHeal?: boolean }) => Promise<ActResultData>;
  openPageCount?: () => number;
};

export type ActHandoff = {
  priorActions: Action[];
  focus?: (tree: string) => string;
  cacheable: boolean;
};

export type ActResolution =
  | {
      kind: "resolved";
      result: ActResultData;
      path: string;
      cacheable: boolean;
    }
  | (Abstained & { handoff: ActHandoff });

export interface ActDriver {
  readonly name: string;
  readonly startsBeforeSettle: boolean;
  prepare?(request: ActRequest): void;
  resolve(request: ActRequest, handoff?: ActHandoff): Promise<ActResolution>;
}

export interface CachedActionGuard {
  check(
    action: Action,
    request: Pick<
      ActRequest,
      "instruction" | "variables" | "page" | "logger" | "progress" | "ensureTimeRemaining"
    >,
  ): Promise<{ verdict: "ok" } | { verdict: "stale"; detail: string }>;
}

export type ObserveRequest = {
  instruction?: string;
  variables?: Variables;
  page: Pick<Page, "captureSnapshot">;
  snapshotOptions: SnapshotOptions;
  progress: Progress;
  ensureTimeRemaining: () => void;
  logger: StagehandLogger;
  llm: LlmPort;
};

export type ObserveResolution = { kind: "resolved"; actions: Action[] } | Abstained;

export interface ObserveDriver {
  readonly name: string;
  resolve(request: ObserveRequest): Promise<ObserveResolution>;
}

export type ExtractRequest = {
  instruction: string;
  jsonSchema: unknown;
  schema: z.ZodType;
  snapshot: { tree: string; urlMap: Record<string, string> };
  screenshot?: Uint8Array;
  progress: Progress;
  ensureTimeRemaining: () => void;
  logger: StagehandLogger;
  llm: LlmPort;
};

export type ExtractResolution = { kind: "resolved"; data: unknown } | Abstained;

export interface ExtractDriver {
  readonly name: string;
  resolve(request: ExtractRequest): Promise<ExtractResolution>;
}

export type CompletionJudge = (extracted: unknown, request: ExtractRequest) => Promise<boolean>;

export type Drivers = {
  act: ActDriver;
  observe: ObserveDriver;
  extract: ExtractDriver;
  cachedActionGuard?: CachedActionGuard;
  logActTiming?: boolean;
};

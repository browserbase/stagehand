import { z } from "zod";
import type { AvailableModel } from "@browserbasehq/stagehand";
import type { LogLine } from "@browserbasehq/stagehand";
import type { AgentInstance } from "@browserbasehq/stagehand";
import type { EvalCase } from "braintrust";
import type { V3 } from "@browserbasehq/stagehand";
import { EvalLogger } from "../logger";

export type StagehandInitResult = {
  v3?: V3;
  v3Agent?: AgentInstance;
  logger: EvalLogger;
  debugUrl: string;
  sessionUrl: string;
  modelName: AvailableModel;
  agent: AgentInstance;
};

export type EvalFunction = (
  taskInput: StagehandInitResult & { input: EvalInput },
) => Promise<{
  _success: boolean;
  logs: LogLine[];
  debugUrl: string;
  sessionUrl: string;
  error?: unknown;
}>;

export const EvalCategorySchema = z.enum([
  "observe",
  "act",
  "combination",
  "extract",
  "experimental",
  "targeted_extract",
  "regression",
  "regression_llm_providers",
  "llm_clients",
  "agent",
  "external_agent_benchmarks",
]);

export type EvalCategory = z.infer<typeof EvalCategorySchema>;
export interface EvalInput {
  name: string;
  modelName: AvailableModel;
  isCUA?: boolean;
  // Optional per-test parameters, used by data-driven tasks
  params?: Record<string, unknown>;
}

export interface TestcaseMetadata {
  model: AvailableModel;
  test: string;
  categories?: string[];
  skill?: string;
  task_id?: string;
  difficulty?: string;
  website?: string;
  [key: string]: unknown;
}

export interface Testcase
  extends EvalCase<
    EvalInput,
    unknown,
    TestcaseMetadata
  > {
  input: EvalInput;
  name: string;
  tags: string[];
  metadata: TestcaseMetadata;
  expected: unknown;
}

export interface EvalMetrics {
  turns?: number;
  costUsd?: number;
  durationMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  totalEvalRuntimeMs?: number;
  screenshotCount?: number;
}

export interface SummaryResult {
  input: EvalInput;
  output: { _success: boolean; metrics?: EvalMetrics };
  name: string;
  score: number;
}

export interface EvalArgs<TInput, TOutput, TExpected> {
  input: TInput;
  output: TOutput;
  expected: TExpected;
  metadata?: { model: AvailableModel; test: string };
}

export interface EvalResult {
  name: string;
  score: number;
}

export type LogLineEval = LogLine & {
  parsedAuxiliary?: string | object;
};

export type AgentModelEntry = {
  modelName: string;
  cua: boolean;
};

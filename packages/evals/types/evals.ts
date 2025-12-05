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

export interface Testcase
  extends EvalCase<
    EvalInput,
    unknown,
    { model: AvailableModel; test: string; categories?: string[] }
  > {
  input: EvalInput;
  name: string;
  tags: string[];
  metadata: { model: AvailableModel; test: string; categories?: string[] };
  expected: unknown;
}

export interface SummaryResult {
  input: EvalInput;
  output: { _success: boolean };
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

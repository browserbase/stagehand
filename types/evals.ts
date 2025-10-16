import { z } from "zod/v3";
import type { AvailableModel } from "../types/model";
import type { LogLine } from "../types/log";
import type { AgentInstance } from "../types/agent";
import type { EvalCase } from "braintrust";
import { Stagehand } from "@/dist";
import { ConstructorParams } from "@/dist";
import { EvalLogger } from "@/evals/logger";

export type StagehandInitResult = {
  stagehand: Stagehand;
  logger: EvalLogger;
  debugUrl: string;
  sessionUrl: string;
  stagehandConfig: ConstructorParams;
  modelName: AvailableModel;
  agent: AgentInstance;
};

export enum ErrorType {
  TIMEOUT = "timeout",
  NETWORK = "network",
  AGENT_FAILURE = "agent_failure",
  EVALUATION_ERROR = "evaluation_error",
  SETUP_ERROR = "setup_error",
  PARSING_ERROR = "parsing_error",
  PROXY_ERROR = "proxy_error",
  ANTIBOT = "bot_detected",
  UNKNOWN = "unknown",
}

export interface EvalOutput {
  _success: boolean;
  logs: LogLine[];
  debugUrl: string;
  sessionUrl: string;
  error?: unknown;
  error_type?: ErrorType;
  error_message?: string;
  error_stack?: string;
  execution_time?: number;
  agent_steps?: number;
  final_answer?: string;
  reasoning?: string;
  observations?: string | unknown; // Allow both string and arrays for backward compatibility
  [key: string]: unknown; // Allow additional fields for flexibility
}

export type EvalFunction = (
  taskInput: StagehandInitResult & { input: EvalInput },
) => Promise<EvalOutput>;

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
  // Optional per-test parameters, used by data-driven tasks
  params?: Record<string, unknown>;
}

export interface TestcaseMetadata {
  model: AvailableModel;
  test: string;
  category?: string;
  dataset?: string;
  dataset_id?: string;
  dataset_level?: string | number;
  dataset_category?: string;
  [key: string]: unknown;
}

export interface Testcase
  extends EvalCase<EvalInput, unknown, TestcaseMetadata> {
  input: EvalInput;
  name: string;
  tags: string[];
  metadata: TestcaseMetadata;
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

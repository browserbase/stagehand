import { EvalLogger } from "../evals/utils";
import { AvailableModel } from "../types/model";
import { LogLine } from "../types/log";
import { z } from "zod";
import { EvalCase } from "braintrust";

export type EvalFunction = (args: {
  modelName: AvailableModel;
  logger: EvalLogger;
}) => Promise<{
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
]);

export type EvalCategory = z.infer<typeof EvalCategorySchema>;
export interface EvalInput {
  name: string;
  modelName: AvailableModel;
}

export interface Testcase
  extends EvalCase<
    EvalInput,
    unknown,
    { model: AvailableModel; test: string }
  > {
  input: EvalInput;
  name: string;
  tags: string[];
  metadata: { model: AvailableModel; test: string };
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

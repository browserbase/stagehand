import { EvalLogger } from "../evals/utils";
import { AvailableModel } from "../types/model";
import { LogLine } from "../types/log";
import { z } from "zod";

export type EvalFunction = (args: {
  modelName: AvailableModel;
  logger: EvalLogger;
}) => Promise<{
  _success: boolean;
  logs: LogLine[];
  debugUrl: string;
  sessionUrl: string;
  error?: any;
}>;

export const EvalCategory = z.enum([
  "observe",
  "act",
  "combination",
  "extract",
  "experimental",
]);

export type EvalCategory = z.infer<typeof EvalCategory>;

import { EvalLogger } from "../evals/utils";
import { AvailableModel } from "../types/model";
import { LogLine } from "../types/log";

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

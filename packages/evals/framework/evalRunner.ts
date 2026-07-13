import type { TaskResult } from "./types.js";
import type { EvalInput, Testcase } from "../types/evals.js";
import { loadBraintrust } from "./braintrust.js";

export interface EvalRunnerConfig {
  projectName: string;
  experimentName: string;
  metadata: Record<string, unknown>;
  data: () => Testcase[];
  task: (input: EvalInput) => Promise<TaskResult>;
  scores: unknown[];
  maxConcurrency: number;
  trialCount: number;
  sendLogs: boolean;
}

export interface EvalRunnerResult {
  results: Array<{
    input: EvalInput;
    output: TaskResult | boolean;
    metadata?: Record<string, unknown>;
    [key: string]: unknown;
  }>;
  summary: {
    experimentName: string;
    experimentId?: string;
    experimentUrl?: string;
    projectName: string;
    projectUrl?: string;
    scores: Record<string, unknown>;
  };
}

export interface EvalRunner {
  run(config: EvalRunnerConfig): Promise<EvalRunnerResult>;
}

const silentBraintrustProgress = {
  start: (): void => {},
  increment: (): void => {},
  stop: (): void => {},
};

const silentBraintrustReporter = {
  name: "stagehand-evals-silent-reporter",
  async reportEval(): Promise<boolean> {
    return true;
  },
  async reportRun(): Promise<boolean> {
    return true;
  },
};

export class BraintrustEvalRunner implements EvalRunner {
  async run(config: EvalRunnerConfig): Promise<EvalRunnerResult> {
    const { Eval, flush } = await loadBraintrust();
    const evalResult = await Eval(
      config.projectName,
      {
        experimentName: config.experimentName,
        metadata: config.metadata,
        data: config.data,
        task: config.task,
        scores: config.scores as unknown as never,
        maxConcurrency: config.maxConcurrency,
        trialCount: config.trialCount,
      },
      {
        progress: silentBraintrustProgress,
        reporter: silentBraintrustReporter,
        ...(config.sendLogs ? {} : { noSendLogs: true }),
      },
    );

    if (config.sendLogs) {
      await flush();
    }

    return evalResult;
  }
}

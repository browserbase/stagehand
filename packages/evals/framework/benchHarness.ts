import type { AgentInstance, V3 } from "@browserbasehq/stagehand";
import { EvalsError } from "../errors.js";
import type { EvalLogger } from "../logger.js";
import type { EvalInput } from "../types/evals.js";
import { ClaudeAgentHarness } from "./ClaudeAgentHarness.js";
import { CodexAgentHarness } from "./CodexAgentHarness.js";
import { StagehandAgentV3Harness } from "./StagehandAgentV3Harness.js";
import type { UnderstudyV4NativeRuntime } from "./UnderstudyV4Tools.js";
import type { DiscoveredTask, TaskResult } from "./types.js";
import type { BenchMatrixRow, BenchTaskKind, Harness } from "./benchTypes.js";

type Page = ReturnType<V3["context"]["pages"]>[number];

export interface BenchHarnessStartInput {
  task: DiscoveredTask;
  input: EvalInput;
  row: BenchMatrixRow;
  logger: EvalLogger;
  verbose?: boolean;
}

export interface BenchHarnessExecuteInput extends BenchHarnessStartInput {
  signal?: AbortSignal;
}

export interface BenchHarnessContext {
  harness: Harness;
  row: BenchMatrixRow;
  logger: EvalLogger;
  v3?: V3;
  v4?: UnderstudyV4NativeRuntime;
  agent?: AgentInstance;
  page?: Page;
  debugUrl: string;
  onTaskStart?: () => void | Promise<void>;
  sessionUrl: string;
}

export interface StartedBenchHarness {
  ctx: BenchHarnessContext;
  cleanup: () => Promise<void>;
}

export interface BenchHarness {
  harness: Harness;
  supportedTaskKinds: BenchTaskKind[];
  supportsApi: boolean;
  execute?(input: BenchHarnessExecuteInput): Promise<TaskResult>;
  start(input: BenchHarnessStartInput): Promise<StartedBenchHarness>;
}

export const StagehandAgentV4Harness: BenchHarness = {
  harness: "stagehand_v4",
  supportedTaskKinds: [
    "act",
    "extract",
    "observe",
    "agent",
    "combination",
    "suite",
  ],
  supportsApi: false,
  async start(input: BenchHarnessStartInput): Promise<StartedBenchHarness> {
    const module = await import("./StagehandAgentV4Harness.js");
    return module.StagehandAgentV4Harness.start(input);
  },
};

const harnessRegistry = new Map<Harness, BenchHarness>([
  ["stagehand_v3", StagehandAgentV3Harness],
  ["stagehand_v4", StagehandAgentV4Harness],
  ["claude_code", ClaudeAgentHarness],
  ["codex", CodexAgentHarness],
]);

export function getBenchHarness(harness: Harness): BenchHarness {
  const implementation = harnessRegistry.get(harness);
  if (!implementation) {
    throw new EvalsError(`Harness "${harness}" is not implemented yet.`);
  }
  return implementation;
}

export { ClaudeAgentHarness } from "./ClaudeAgentHarness.js";
export { CodexAgentHarness } from "./CodexAgentHarness.js";
export { StagehandAgentV3Harness } from "./StagehandAgentV3Harness.js";

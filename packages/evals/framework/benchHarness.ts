import { V3, normalizeRubric, type TaskSpec } from "stagehand-v3";
import { EvalsError } from "../errors.js";
import type { EvalLogger } from "../logger.js";
import type { StagehandInitResult } from "../initStagehand.js";
import type { EvalInput } from "../types/evals.js";
import { runClaudeCodeAgent } from "./claudeCodeRunner.js";
import {
  prepareClaudeCodeToolAdapter,
  type PreparedClaudeCodeToolAdapter,
} from "./claudeCodeToolAdapter.js";
import { runCodexAgent } from "./codexRunner.js";
import { prepareCodexToolAdapter, type PreparedCodexToolAdapter } from "./codexToolAdapter.js";
import { buildExternalHarnessTaskPlan } from "./externalHarnessPlan.js";
import type { DiscoveredTask, TaskResult } from "./types.js";
import type { BenchMatrixRow, BenchTaskKind, Harness } from "./benchTypes.js";

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

interface BenchHarnessContextBase {
  harness: Harness;
  row: BenchMatrixRow;
  logger: EvalLogger;
  debugUrl: string;
  sessionUrl: string;
}

export type BenchHarnessContext = BenchHarnessContextBase & {
  stagehand: StagehandInitResult["stagehand"];
  page: StagehandInitResult["page"];
};

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

/**
 * Build a verifier-carrier V3 instance. Used only as the LLM-client carrier
 * for V3Evaluator.verify() — never `init()`-ed, never drives a browser.
 * The instance's logger is what V3Evaluator uses to construct its LLMProvider.
 *
 * The model is deliberately left at V3's default: the harness model can be a
 * runner-only alias (e.g. "codex/default") that V3's provider map rejects at
 * construction, and V3Evaluator selects its own verifier model regardless.
 */
function buildVerifierCarrierV3(logger: EvalLogger): V3 {
  return new V3({
    env: "LOCAL",
    logger: logger.log.bind(logger),
    disablePino: true,
    disableAPI: true,
    experimental: true,
    verbose: 0,
  });
}

function buildExternalHarnessTaskSpec(
  plan: ReturnType<typeof buildExternalHarnessTaskPlan>,
  input: EvalInput,
): TaskSpec {
  // Datasets that ship curated rubrics (WebTailBench) carry them in
  // params.precomputed_rubric — thread them through so external-harness runs
  // grade against the same rubric as the stagehand harness instead of
  // LLM-generating a divergent one.
  const precomputedRubric = normalizeRubric(input.params?.precomputed_rubric);
  return {
    id: plan.taskId ?? input.name,
    instruction: plan.instruction,
    initUrl: plan.startUrl,
    ...(precomputedRubric && { precomputedRubric }),
  };
}

export const stagehandHarness: BenchHarness = {
  harness: "stagehand",
  supportedTaskKinds: ["act", "extract", "observe"],
  supportsApi: false,
  async start({ task, input, row, logger }: BenchHarnessStartInput): Promise<StartedBenchHarness> {
    if (row.config.harness !== "stagehand") {
      throw new EvalsError(
        `Harness "${row.config.harness}" is not implemented yet. Use --harness stagehand for the current unified runner.`,
      );
    }
    const config = row.config;
    if (!["act", "extract", "observe"].includes(task.primaryCategory)) {
      throw new EvalsError(
        `The stagehand harness runs act/extract/observe tasks only. Run agent suites with --harness claude_code or --harness codex; received "${task.name}".`,
      );
    }
    if (input.agentMode) {
      throw new EvalsError("Agent modes were removed with the v3 agent path.");
    }
    if (input.isCUA) {
      throw new EvalsError("CUA runs were removed with the v3 agent path.");
    }
    if (config.useApi) {
      throw new EvalsError("--api is not supported with the Stagehand SDK harness.");
    }

    const { initStagehand } = await import("../initStagehand.js");
    const v4Result = await initStagehand({
      logger,
      modelName: input.modelName,
      environment: config.environment,
    });
    return {
      ctx: {
        harness: "stagehand",
        row,
        logger,
        stagehand: v4Result.stagehand,
        page: v4Result.page,
        debugUrl: v4Result.debugUrl,
        sessionUrl: v4Result.sessionUrl,
      },
      cleanup: v4Result.cleanup,
    };
  },
};

export const claudeCodeHarness: BenchHarness = {
  harness: "claude_code",
  supportedTaskKinds: ["agent", "suite"],
  supportsApi: false,
  async execute({ input, row, logger, signal }: BenchHarnessExecuteInput): Promise<TaskResult> {
    const plan = buildExternalHarnessTaskPlan(input);
    if (row.config.harness !== "claude_code") {
      throw new EvalsError(
        `Expected claude_code harness config, received "${row.config.harness}".`,
      );
    }
    // Everything past carrier construction runs inside one try/finally so a
    // failure at any point — adapter preparation included — cleans up both
    // the adapter and the carrier.
    const carrierV3 = buildVerifierCarrierV3(logger);
    let toolAdapter: PreparedClaudeCodeToolAdapter | undefined;
    try {
      toolAdapter = await prepareClaudeCodeToolAdapter({
        toolSurface: row.config.toolSurface,
        startupProfile: row.config.startupProfile,
        environment: row.config.environment,
        plan,
        logger,
      });
      return await runClaudeCodeAgent({
        plan,
        model: input.modelName,
        logger,
        toolAdapter,
        signal,
        verifier: {
          v3: carrierV3,
          taskSpec: buildExternalHarnessTaskSpec(plan, input),
          dataset: plan.dataset,
        },
      });
    } finally {
      await toolAdapter?.cleanup();
      // Deregister the never-init()-ed carrier (instance registry, event
      // store, logger binding) so long matrix runs don't accumulate one
      // V3 object graph per task.
      await carrierV3.close().catch(() => {});
    }
  },
  async start(): Promise<StartedBenchHarness> {
    throw new EvalsError(
      "Claude Code harness execution uses the external harness execute path. Use --dry-run to inspect its bench matrix, or run with --harness claude_code.",
    );
  },
};

export const codexHarness: BenchHarness = {
  harness: "codex",
  supportedTaskKinds: ["agent", "suite"],
  supportsApi: false,
  async execute({ input, row, logger, signal }: BenchHarnessExecuteInput): Promise<TaskResult> {
    const plan = buildExternalHarnessTaskPlan(input);
    if (row.config.harness !== "codex") {
      throw new EvalsError(`Expected codex harness config, received "${row.config.harness}".`);
    }
    // Everything past carrier construction runs inside one try/finally so a
    // failure at any point — adapter preparation included — cleans up both
    // the adapter and the carrier.
    const carrierV3 = buildVerifierCarrierV3(logger);
    let toolAdapter: PreparedCodexToolAdapter | undefined;
    try {
      toolAdapter = await prepareCodexToolAdapter({
        toolSurface: row.config.toolSurface,
        startupProfile: row.config.startupProfile,
        environment: row.config.environment,
        plan,
        logger,
      });
      return await runCodexAgent({
        plan,
        model: input.modelName,
        logger,
        toolAdapter,
        signal,
        verifier: {
          v3: carrierV3,
          taskSpec: buildExternalHarnessTaskSpec(plan, input),
          dataset: plan.dataset,
        },
      });
    } finally {
      await toolAdapter?.cleanup();
      // Deregister the never-init()-ed carrier (instance registry, event
      // store, logger binding) so long matrix runs don't accumulate one
      // V3 object graph per task.
      await carrierV3.close().catch(() => {});
    }
  },
  async start(): Promise<StartedBenchHarness> {
    throw new EvalsError(
      "Codex harness execution uses the external harness execute path. Use --dry-run to inspect its bench matrix, or run with --harness codex.",
    );
  },
};

const harnessRegistry = new Map<Harness, BenchHarness>([
  ["stagehand", stagehandHarness],
  ["claude_code", claudeCodeHarness],
  ["codex", codexHarness],
]);

export function getBenchHarness(harness: Harness): BenchHarness {
  const implementation = harnessRegistry.get(harness);
  if (!implementation) {
    throw new EvalsError(
      `Harness "${harness}" is not implemented yet. Use --harness stagehand for the current unified runner.`,
    );
  }
  return implementation;
}

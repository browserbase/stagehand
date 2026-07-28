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
import type { DiscoveredTask, TaskDefinition, TaskResult } from "./types.js";
import type { BenchMatrixRow, BenchTaskKind, Harness } from "./benchTypes.js";

export interface BenchHarnessStartInput {
  task: DiscoveredTask;
  input: EvalInput;
  row: BenchMatrixRow;
  logger: EvalLogger;
  taskDefinition?: TaskDefinition;
  verbose?: boolean;
}

export interface BenchHarnessExecuteInput extends BenchHarnessStartInput {
  signal?: AbortSignal;
}

export interface BenchHarnessContext {
  harness: Harness;
  row: BenchMatrixRow;
  logger: EvalLogger;
  stagehand: StagehandInitResult["stagehand"];
  page: StagehandInitResult["page"];
  debugUrl: string;
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

function isAgentTask(task: DiscoveredTask): boolean {
  return (
    task.primaryCategory === "agent" ||
    task.categories.includes("agent") ||
    task.categories.includes("external_agent_benchmarks")
  );
}

/**
 * Build the lightweight client required by the rubric verifier. It is never
 * initialized and never drives a browser.
 */
function buildVerifierCarrier(logger: EvalLogger): V3 {
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
  supportedTaskKinds: ["act", "extract", "observe", "combination"],
  supportsApi: false,
  async start({
    task,
    input,
    row,
    logger,
    taskDefinition,
  }: BenchHarnessStartInput): Promise<StartedBenchHarness> {
    if (row.config.harness !== "stagehand") {
      throw new EvalsError(
        `Harness "${row.config.harness}" is not implemented yet. Use --harness stagehand for the current unified runner.`,
      );
    }
    const config = row.config;
    if (isAgentTask(task) || config.agentMode || config.isCUA || input.agentMode || input.isCUA) {
      throw new EvalsError("The Stagehand harness does not support agent tasks or agent modes.");
    }
    if (config.useApi) {
      throw new EvalsError("--api is not supported by the Stagehand harness.");
    }

    const { initStagehand } = await import("../initStagehand.js");
    const meta = taskDefinition?.meta;
    const systemPrompt = meta && "systemPrompt" in meta ? meta.systemPrompt : undefined;
    const result = await initStagehand({
      logger,
      modelName: input.modelName,
      systemPrompt,
      environment: config.environment,
    });
    return {
      ctx: {
        harness: "stagehand",
        row,
        logger,
        stagehand: result.stagehand,
        page: result.page,
        debugUrl: "",
        sessionUrl: result.sessionUrl ?? "",
      },
      cleanup: async () => {
        try {
          await result.stagehand.close();
        } catch (closeError) {
          console.error(`Warning: Error closing Stagehand for ${input.name}:`, closeError);
        }
      },
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
    const verifierClient = buildVerifierCarrier(logger);
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
          v3: verifierClient,
          taskSpec: buildExternalHarnessTaskSpec(plan, input),
          dataset: plan.dataset,
        },
      });
    } finally {
      await toolAdapter?.cleanup();
      await verifierClient.close().catch(() => {});
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
    const verifierClient = buildVerifierCarrier(logger);
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
          v3: verifierClient,
          taskSpec: buildExternalHarnessTaskSpec(plan, input),
          dataset: plan.dataset,
        },
      });
    } finally {
      await toolAdapter?.cleanup();
      await verifierClient.close().catch(() => {});
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

import { V3, normalizeRubric, type AvailableModel, type TaskSpec } from "stagehand-v3";
import { EvalsError } from "../errors.js";
import type { EvalLogger } from "../logger.js";
import type { StagehandInitResult } from "../initStagehand.js";
import type { EvalInput } from "../types/evals.js";
import { runClaudeCodeAgent } from "./claudeCodeRunner.js";
import {
  CLAUDE_CODE_TOOL_SURFACES,
  prepareClaudeCodeToolAdapter,
} from "./claudeCodeToolAdapter.js";
import { runCodexAgent } from "./codexRunner.js";
import { CODEX_TOOL_SURFACES, prepareCodexToolAdapter } from "./codexToolAdapter.js";
import { runMastraAgent } from "./mastraRunner.js";
import { MASTRA_TOOL_SURFACES, prepareMastraToolAdapter } from "./mastraToolAdapter.js";
import { runPiAgent } from "./piRunner.js";
import { PI_TOOL_SURFACES, preparePiToolAdapter } from "./piToolAdapter.js";
import { runEveAgent } from "./eveRunner.js";
import { EVE_TOOL_SURFACES, prepareEveToolAdapter } from "./eveToolAdapter.js";
import { runDeepagentsAgent } from "./deepagentsRunner.js";
import { DEEPAGENTS_TOOL_SURFACES, prepareDeepagentsToolAdapter } from "./deepagentsToolAdapter.js";
import { runFxAgent } from "./fxRunner.js";
import { FX_TOOL_SURFACES, prepareFxToolAdapter } from "./fxToolAdapter.js";
import { runCursorAgent } from "./cursorRunner.js";
import { CURSOR_TOOL_SURFACES, prepareCursorToolAdapter } from "./cursorToolAdapter.js";
import {
  buildExternalHarnessTaskPlan,
  type ExternalHarnessTaskPlan,
} from "./externalHarnessPlan.js";
import { withHarnessAgentSpan } from "./otel.js";
import type { DiscoveredTask, TaskResult } from "./types.js";
import type { BenchMatrixRow, BenchTaskKind, Harness } from "./benchTypes.js";
import { DEFAULT_BENCH_HARNESS } from "./benchTypes.js";
import type { StartupProfile, ToolSurface } from "../core/contracts/tool.js";
import type { ExternalHarnessVerifierConfig } from "./verifierAdapter.js";

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
  /**
   * Tool surfaces this harness can mount for the agent, in display order; the
   * first entry is the default when --tool is omitted. An empty list means the
   * harness does not mount tool surfaces and the planner passes the requested
   * surface/profile through unchanged as row metadata (stagehand harness).
   */
  supportedToolSurfaces: ToolSurface[];
  /**
   * Default model ids for rows planned on this harness when --model is omitted.
   * Overridable at runtime with EVAL_<HARNESS_UPPER>_MODELS (comma separated).
   * Harnesses without a list fall back to the category model list (getModelList).
   */
  defaultModels?: AvailableModel[];
  execute?(input: BenchHarnessExecuteInput): Promise<TaskResult>;
  /**
   * A harness with neither execute nor start is registered for planning/dry-run
   * only and is rejected by the CLI before execution.
   */
  start?(input: BenchHarnessStartInput): Promise<StartedBenchHarness>;
}

export interface ExternalHarnessPrepareInput {
  toolSurface?: ToolSurface;
  startupProfile?: StartupProfile;
  environment: "LOCAL" | "BROWSERBASE";
  plan: ExternalHarnessTaskPlan;
  logger: EvalLogger;
}

export interface ExternalHarnessRunInput<TAdapter> {
  plan: ExternalHarnessTaskPlan;
  model: AvailableModel;
  logger: EvalLogger;
  toolAdapter: TAdapter;
  signal?: AbortSignal;
  verifier: ExternalHarnessVerifierConfig;
}

export interface ExternalHarnessDefinition<TAdapter extends { cleanup: () => Promise<void> }> {
  harness: string;
  supportedToolSurfaces: ToolSurface[];
  defaultModels: AvailableModel[];
  /** Defaults to ["agent", "suite"]. */
  supportedTaskKinds?: BenchTaskKind[];
  prepareToolAdapter: (input: ExternalHarnessPrepareInput) => Promise<TAdapter>;
  runAgent: (input: ExternalHarnessRunInput<TAdapter>) => Promise<TaskResult>;
}

/**
 * Define the lifecycle common to external agent harnesses without registering
 * it; registry ownership stays explicit so list order remains deterministic.
 */
export function defineExternalHarness<TAdapter extends { cleanup: () => Promise<void> }>(
  definition: ExternalHarnessDefinition<TAdapter>,
): BenchHarness {
  const {
    harness,
    supportedToolSurfaces,
    defaultModels,
    supportedTaskKinds = ["agent", "suite"],
    prepareToolAdapter,
    runAgent,
  } = definition;
  return {
    harness,
    supportedTaskKinds,
    supportsApi: false,
    supportedToolSurfaces,
    defaultModels,
    async execute({ input, row, logger, signal }: BenchHarnessExecuteInput): Promise<TaskResult> {
      if (row.config.harness !== harness) {
        throw new EvalsError(
          `Expected ${harness} harness config, received "${row.config.harness}".`,
        );
      }
      const plan = buildExternalHarnessTaskPlan(input);
      // Everything past carrier construction runs inside one try/finally so a
      // failure at any point — adapter preparation included — cleans up both
      // the adapter and the carrier.
      const carrierV3 = buildVerifierCarrierV3(logger);
      let toolAdapter: TAdapter | undefined;
      try {
        toolAdapter = await prepareToolAdapter({
          toolSurface: row.config.toolSurface,
          startupProfile: row.config.startupProfile,
          environment: row.config.environment,
          plan,
          logger,
        });
        const preparedAdapter = toolAdapter;
        return await withHarnessAgentSpan(
          {
            harness,
            model: input.modelName,
            task: input.name,
            instruction: plan.instruction,
          },
          () =>
            runAgent({
              plan,
              model: input.modelName,
              logger,
              toolAdapter: preparedAdapter,
              signal,
              verifier: {
                v3: carrierV3,
                taskSpec: buildExternalHarnessTaskSpec(plan, input),
                dataset: plan.dataset,
              },
            }),
        );
      } finally {
        try {
          await toolAdapter?.cleanup();
        } finally {
          // Deregister the never-init()-ed carrier (instance registry, event
          // store, logger binding) so long matrix runs don't accumulate one
          // V3 object graph per task.
          await carrierV3.close().catch(() => {});
        }
      }
    },
  };
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
  supportedToolSurfaces: [],
  async start({ task, input, row, logger }: BenchHarnessStartInput): Promise<StartedBenchHarness> {
    if (row.config.harness !== "stagehand") {
      throw new EvalsError(
        `Harness "${row.config.harness}" is not implemented yet. Use --harness stagehand for the current unified runner.`,
      );
    }
    const config = row.config;
    if (!["act", "extract", "observe"].includes(task.primaryCategory)) {
      const suiteHarnesses =
        listBenchHarnessesForTaskKind("suite").filter(isExecutableBenchHarness);
      const suiteGuidance = suiteHarnesses.length
        ? `Run agent suites with ${formatBenchHarnessFlags(suiteHarnesses)}`
        : "No registered harness runs agent suites";
      throw new EvalsError(
        `The stagehand harness runs act/extract/observe tasks only. ${suiteGuidance}; received "${task.name}".`,
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

export const claudeCodeHarness = defineExternalHarness({
  harness: "claude_code",
  supportedToolSurfaces: CLAUDE_CODE_TOOL_SURFACES,
  defaultModels: ["anthropic/claude-sonnet-4-6" as AvailableModel],
  prepareToolAdapter: prepareClaudeCodeToolAdapter,
  runAgent: runClaudeCodeAgent,
});

export const codexHarness = defineExternalHarness({
  harness: "codex",
  supportedToolSurfaces: CODEX_TOOL_SURFACES,
  defaultModels: ["openai/gpt-5.4-mini" as AvailableModel],
  prepareToolAdapter: prepareCodexToolAdapter,
  runAgent: runCodexAgent,
});

export const mastraHarness = defineExternalHarness({
  harness: "mastra",
  supportedToolSurfaces: MASTRA_TOOL_SURFACES,
  defaultModels: ["openai/gpt-5.4-mini" as AvailableModel],
  prepareToolAdapter: prepareMastraToolAdapter,
  runAgent: runMastraAgent,
});

export const piHarness = defineExternalHarness({
  harness: "pi",
  supportedToolSurfaces: PI_TOOL_SURFACES,
  defaultModels: ["openai/gpt-5.4-mini" as AvailableModel],
  prepareToolAdapter: preparePiToolAdapter,
  runAgent: runPiAgent,
});

export const eveHarness = defineExternalHarness({
  harness: "eve",
  supportedToolSurfaces: EVE_TOOL_SURFACES,
  defaultModels: ["openai/gpt-5.4-mini" as AvailableModel],
  prepareToolAdapter: prepareEveToolAdapter,
  runAgent: runEveAgent,
});

export const deepagentsHarness = defineExternalHarness({
  harness: "deepagents",
  supportedToolSurfaces: DEEPAGENTS_TOOL_SURFACES,
  defaultModels: ["openai/gpt-5.4-mini" as AvailableModel],
  prepareToolAdapter: prepareDeepagentsToolAdapter,
  runAgent: runDeepagentsAgent,
});

export const fxHarness = defineExternalHarness({
  harness: "fx",
  supportedToolSurfaces: FX_TOOL_SURFACES,
  defaultModels: ["openai/gpt-5.4-mini" as AvailableModel],
  prepareToolAdapter: prepareFxToolAdapter,
  runAgent: runFxAgent,
});

export const cursorHarness = defineExternalHarness({
  harness: "cursor",
  supportedToolSurfaces: CURSOR_TOOL_SURFACES,
  defaultModels: ["cursor/auto" as AvailableModel],
  prepareToolAdapter: prepareCursorToolAdapter,
  runAgent: runCursorAgent,
});

const harnessRegistry = new Map<Harness, BenchHarness>([
  ["stagehand", stagehandHarness],
  ["claude_code", claudeCodeHarness],
  ["codex", codexHarness],
  ["mastra", mastraHarness],
  ["pi", piHarness],
  ["eve", eveHarness],
  ["deepagents", deepagentsHarness],
  ["fx", fxHarness],
  ["cursor", cursorHarness],
]);

export function registerBenchHarness(harness: BenchHarness): () => void {
  if (harnessRegistry.has(harness.harness)) {
    throw new EvalsError(`Harness "${harness.harness}" is already registered.`);
  }
  harnessRegistry.set(harness.harness, harness);
  return () => {
    if (harnessRegistry.get(harness.harness) === harness) {
      harnessRegistry.delete(harness.harness);
    }
  };
}

export function listBenchHarnesses(): Harness[] {
  return [...harnessRegistry.keys()];
}

export function listBenchHarnessesForToolSurface(toolSurface: ToolSurface): Harness[] {
  return listExecutableBenchHarnesses().filter((harness) =>
    harnessRegistry.get(harness)?.supportedToolSurfaces.includes(toolSurface),
  );
}

export function listBenchHarnessesForTaskKind(taskKind: BenchTaskKind): Harness[] {
  return listBenchHarnesses().filter((harness) =>
    harnessRegistry.get(harness)?.supportedTaskKinds.includes(taskKind),
  );
}

function hasExecutableImplementation(harness: Harness): boolean {
  const implementation = harnessRegistry.get(harness);
  return implementation?.execute !== undefined || implementation?.start !== undefined;
}

export function listExecutableBenchHarnesses(): Harness[] {
  return listBenchHarnesses().filter(hasExecutableImplementation);
}

export function getBenchHarness(harness: Harness): BenchHarness {
  const implementation = harnessRegistry.get(harness);
  if (!implementation) {
    throw new EvalsError(
      `Harness "${harness}" is not implemented yet. Use --harness stagehand for the current unified runner.`,
    );
  }
  return implementation;
}

export function isBenchHarness(value: string): value is Harness {
  return harnessRegistry.has(value);
}

export function isExecutableBenchHarness(value: Harness): boolean {
  return isBenchHarness(value) && hasExecutableImplementation(value);
}

export function parseBenchHarness(value: string | undefined): Harness {
  if (!value) return DEFAULT_BENCH_HARNESS;
  if (isBenchHarness(value)) return value;
  throw new EvalsError(
    `Unknown harness "${value}". Supported: ${listBenchHarnesses().join(", ")}.`,
  );
}

export function formatBenchHarnessFlags(
  harnesses: Harness[] = listExecutableBenchHarnesses(),
): string {
  const flags = harnesses.map((harness) => `--harness ${harness}`);
  if (flags.length <= 1) return flags[0] ?? "";
  if (flags.length === 2) return flags.join(" or ");
  return `${flags.slice(0, -1).join(", ")}, or ${flags.at(-1)}`;
}

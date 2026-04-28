import {
  AVAILABLE_CUA_MODELS,
  type AgentToolMode,
  type AvailableModel,
} from "@browserbasehq/stagehand";
import { EvalsError } from "../errors.js";
import { buildOnlineMind2WebTestcases } from "../suites/onlineMind2Web.js";
import { buildWebTailBenchTestcases } from "../suites/webtailbench.js";
import { buildWebVoyagerTestcases } from "../suites/webvoyager.js";
import {
  getAgentModelEntries,
  getModelList,
  type AgentModelEntry,
} from "../taskConfig.js";
import type { Testcase } from "../types/evals.js";
import type {
  StartupProfile,
  ToolSurface,
} from "../core/contracts/tool.js";
import type { DiscoveredTask } from "./types.js";
import {
  DEFAULT_BENCH_HARNESS,
  type BenchMatrixRow,
  type BenchTaskKind,
  type Harness,
} from "./benchTypes.js";

export interface BenchPlanOptions {
  environment?: "LOCAL" | "BROWSERBASE";
  useApi?: boolean;
  modelOverride?: string;
  provider?: string;
  categoryFilter?: string;
  datasetFilter?: string;
  agentMode?: AgentToolMode;
  harness?: Harness;
  coreToolSurface?: ToolSurface;
  coreStartupProfile?: StartupProfile;
}

export interface BenchModelResolution {
  effectiveCategory: string | null;
  isAgentCategory: boolean;
  modelEntries: AgentModelEntry[];
}

export interface SuiteTestcaseResult {
  testcases: Testcase[];
  remainingTasks: DiscoveredTask[];
}

export function inferEffectiveBenchCategory(
  benchTasks: DiscoveredTask[],
  categoryFilter?: string | null,
): string | null {
  let effectiveCategory = categoryFilter ?? null;
  if (
    !effectiveCategory &&
    benchTasks.length === 1 &&
    benchTasks[0].categories.length === 1 &&
    (benchTasks[0].categories[0] === "agent" ||
      benchTasks[0].categories[0] === "external_agent_benchmarks")
  ) {
    effectiveCategory = benchTasks[0].categories[0];
  }

  return effectiveCategory;
}

export function resolveBenchModelEntries(
  benchTasks: DiscoveredTask[],
  options: Pick<
    BenchPlanOptions,
    "categoryFilter" | "modelOverride" | "agentMode"
  >,
): BenchModelResolution {
  const effectiveCategory = inferEffectiveBenchCategory(
    benchTasks,
    options.categoryFilter,
  );
  const isAgentCategory =
    effectiveCategory === "agent" ||
    effectiveCategory === "external_agent_benchmarks";

  if (options.modelOverride) {
    const mode = resolveAgentModeForModel(
      options.modelOverride,
      options.agentMode,
    );
    return {
      effectiveCategory,
      isAgentCategory,
      modelEntries: [
        {
          modelName: options.modelOverride,
          mode,
          cua: mode === "cua",
        },
      ],
    };
  }

  return {
    effectiveCategory,
    isAgentCategory,
    modelEntries: isAgentCategory
      ? getAgentModelEntries()
      : getModelList(effectiveCategory).map((m) => ({
          modelName: m,
          mode: "hybrid",
          cua: false,
        })),
  };
}

function resolveAgentModeForModel(
  modelName: string,
  override?: AgentToolMode,
): AgentToolMode {
  if (override) return override;
  return (AVAILABLE_CUA_MODELS as readonly string[]).includes(modelName)
    ? "cua"
    : "hybrid";
}

export function inferBenchTaskKind(task: DiscoveredTask): BenchTaskKind {
  if (task.name.startsWith("agent/")) return "suite";
  if (task.primaryCategory === "agent") return "agent";
  if (isBenchTaskKind(task.primaryCategory)) return task.primaryCategory;
  return "combination";
}

function isBenchTaskKind(value: string): value is BenchTaskKind {
  return (
    value === "act" ||
    value === "extract" ||
    value === "observe" ||
    value === "agent" ||
    value === "combination" ||
    value === "suite"
  );
}

export function buildBenchMatrixRow(
  task: DiscoveredTask,
  modelName: AvailableModel,
  options: BenchPlanOptions,
  params?: Record<string, unknown>,
  isCUA?: boolean,
  agentMode?: AgentToolMode,
): BenchMatrixRow {
  return {
    harness: options.harness ?? DEFAULT_BENCH_HARNESS,
    task: task.name,
    category: task.primaryCategory,
    taskKind: inferBenchTaskKind(task),
    model: modelName,
    provider: options.provider,
    environment: options.environment ?? "LOCAL",
    useApi: Boolean(options.useApi),
    toolSurface: options.coreToolSurface,
    startupProfile: options.coreStartupProfile,
    trial: 1,
    dataset: options.datasetFilter,
    params,
    agentMode,
    isCUA,
  };
}

export function generateBenchTestcases(
  benchTasks: DiscoveredTask[],
  options: BenchPlanOptions,
): Testcase[] {
  const { isAgentCategory, modelEntries } = resolveBenchModelEntries(
    benchTasks,
    options,
  );

  const suiteTestcases = generateSuiteTestcases(
    benchTasks,
    options,
    modelEntries,
  );
  const allTestcases = [...suiteTestcases.testcases];

  for (const entry of modelEntries) {
    for (const task of suiteTestcases.remainingTasks) {
      const model = entry.modelName as AvailableModel;
      const row = buildBenchMatrixRow(
        task,
        model,
        options,
        undefined,
        isAgentCategory ? entry.mode === "cua" : undefined,
        isAgentCategory ? (options.agentMode ?? entry.mode) : undefined,
      );
      const agentMode = row.agentMode;
      allTestcases.push({
        input: {
          name: task.name,
          modelName: model,
          ...(isAgentCategory && {
            agentMode,
            isCUA: agentMode === "cua",
          }),
        },
        name: task.name,
        tags: [
          entry.modelName,
          ...(isAgentCategory && agentMode ? [agentMode] : []),
          task.name,
          ...task.categories.map((x) => `category/${x}`),
          `harness/${row.harness}`,
        ],
        metadata: {
          model,
          test: task.name,
          categories: task.categories,
          task_category: task.primaryCategory,
          harness: row.harness,
          environment: row.environment,
          api: row.useApi,
          provider: row.provider,
          toolSurface: row.toolSurface,
          startupProfile: row.startupProfile,
          agentMode: row.agentMode,
        },
        expected: true,
      });
    }
  }

  return allTestcases;
}

export function generateSuiteTestcases(
  benchTasks: DiscoveredTask[],
  options: BenchPlanOptions,
  modelEntries: AgentModelEntry[],
): SuiteTestcaseResult {
  const testcases: Testcase[] = [];
  const remaining = [...benchTasks];
  const datasetFilter = options.datasetFilter;

  const suiteMap: Record<string, (models: AgentModelEntry[]) => Testcase[]> = {
    "agent/webvoyager": (models) => buildWebVoyagerTestcases(models),
    "agent/onlineMind2Web": (models) => buildOnlineMind2WebTestcases(models),
    "agent/webtailbench": (models) => buildWebTailBenchTestcases(models),
  };
  const legacyOnlySuites = new Set(["agent/gaia"]);

  for (const suiteName of legacyOnlySuites) {
    const idx = remaining.findIndex((t) => t.name === suiteName);
    if (idx === -1) continue;
    throw new EvalsError(
      `Benchmark "${suiteName}" is legacy-only. Use --legacy or choose b:webvoyager / b:onlineMind2Web / b:webtailbench.`,
    );
  }

  for (const [suiteName, builder] of Object.entries(suiteMap)) {
    const idx = remaining.findIndex((t) => t.name === suiteName);
    if (idx === -1) continue;
    const datasetName = suiteName.split("/").pop();
    if (!datasetFilter || datasetFilter === datasetName) {
      const task = remaining[idx];
      testcases.push(
        ...builder(modelEntries).map((testcase) =>
          withBenchMetadata(testcase, task, options),
        ),
      );
    }
    remaining.splice(idx, 1);
  }

  return { testcases, remainingTasks: remaining };
}

function withBenchMetadata(
  testcase: Testcase,
  task: DiscoveredTask,
  options: BenchPlanOptions,
): Testcase {
  const agentMode = options.agentMode ?? testcase.input.agentMode;
  const row = buildBenchMatrixRow(
    task,
    testcase.input.modelName,
    options,
    testcase.input.params,
    agentMode === "cua",
    agentMode,
  );
  const tags = testcase.tags.filter(
    (tag) => tag !== "dom" && tag !== "hybrid" && tag !== "cua",
  );
  if (agentMode) tags.push(agentMode);

  return {
    ...testcase,
    input: {
      ...testcase.input,
      ...(agentMode && { agentMode, isCUA: agentMode === "cua" }),
    },
    tags: [...tags, `harness/${row.harness}`],
    metadata: {
      ...testcase.metadata,
      category: task.categories[0] ?? task.primaryCategory,
      categories: task.categories,
      task_category: task.primaryCategory,
      harness: row.harness,
      environment: row.environment,
      api: row.useApi,
      provider: row.provider,
      toolSurface: row.toolSurface,
      startupProfile: row.startupProfile,
      agentMode: row.agentMode,
    },
  };
}

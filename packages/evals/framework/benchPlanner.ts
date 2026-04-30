import type { AgentToolMode, AvailableModel } from "@browserbasehq/stagehand";
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
import type { StartupProfile, ToolSurface } from "../core/contracts/tool.js";
import type { DiscoveredTask } from "./types.js";
import {
  DEFAULT_BENCH_HARNESS,
  type BenchHarnessConfig,
  type BenchMatrixRow,
  type BenchTaskKind,
  type Harness,
} from "./benchTypes.js";
import {
  getBrowseCliToolMetadata,
  resolveClaudeCodeStartupProfile,
  resolveClaudeCodeToolSurface,
} from "./claudeCodeToolAdapter.js";
import {
  resolveCodexStartupProfile,
  resolveCodexToolSurface,
} from "./codexToolAdapter.js";
import {
  inferDefaultStagehandAgentMode,
  isCuaCapableModel,
} from "./agentModelModes.js";

const DEFAULT_CLAUDE_CODE_MODELS: AvailableModel[] = [
  "anthropic/claude-sonnet-4-6" as AvailableModel,
];
const DEFAULT_CODEX_MODELS: AvailableModel[] = [
  "openai/gpt-5.4-mini" as AvailableModel,
];

export interface BenchPlanOptions {
  environment?: "LOCAL" | "BROWSERBASE";
  useApi?: boolean;
  modelOverride?: string;
  provider?: string;
  categoryFilter?: string;
  datasetFilter?: string;
  agentMode?: AgentToolMode;
  agentModes?: AgentToolMode[];
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
    "categoryFilter" | "modelOverride" | "agentMode" | "agentModes" | "harness"
  >,
): BenchModelResolution {
  const effectiveCategory = inferEffectiveBenchCategory(
    benchTasks,
    options.categoryFilter,
  );
  const isAgentCategory =
    effectiveCategory === "agent" ||
    effectiveCategory === "external_agent_benchmarks";
  const harness = options.harness ?? DEFAULT_BENCH_HARNESS;
  const requestedAgentModes =
    harness === "stagehand" ? resolveRequestedAgentModes(options) : undefined;

  if (options.modelOverride) {
    const baseModes =
      isAgentCategory && requestedAgentModes
        ? requestedAgentModes
        : [
            harness === "stagehand"
              ? resolveAgentModeForModel(options.modelOverride)
              : "hybrid",
          ];
    const modelEntries = uniqueAgentModelEntries(
      baseModes.map((mode) => ({
        modelName: options.modelOverride,
        mode,
        cua: mode === "cua",
      })),
    );
    const compatibleEntries =
      isAgentCategory && requestedAgentModes
        ? expandAgentEntriesForRequestedModes(modelEntries, requestedAgentModes)
        : modelEntries;
    assertCompatibleAgentModelEntries(compatibleEntries, requestedAgentModes);

    return {
      effectiveCategory,
      isAgentCategory,
      modelEntries: compatibleEntries,
    };
  }

  const modelEntries = resolveDefaultModelEntries(
    harness,
    effectiveCategory,
    isAgentCategory,
  );

  return {
    effectiveCategory,
    isAgentCategory,
    modelEntries:
      isAgentCategory && requestedAgentModes
        ? expandAgentEntriesForRequestedModes(modelEntries, requestedAgentModes)
        : modelEntries,
  };
}

function expandAgentEntriesForRequestedModes(
  entries: AgentModelEntry[],
  requestedModes: AgentToolMode[],
): AgentModelEntry[] {
  const expanded = entries.flatMap((entry) => {
    if (isCuaCapableModel(entry.modelName)) {
      return requestedModes.map((mode) => ({
        modelName: entry.modelName,
        mode,
        cua: mode === "cua",
      }));
    }

    return requestedModes
      .filter((mode) => mode !== "cua")
      .map((mode) => ({
        modelName: entry.modelName,
        mode,
        cua: false,
      }));
  });

  return uniqueAgentModelEntries(expanded);
}

function uniqueAgentModelEntries(
  entries: AgentModelEntry[],
): AgentModelEntry[] {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    const key = `${entry.modelName}:${entry.mode}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function assertCompatibleAgentModelEntries(
  entries: AgentModelEntry[],
  requestedModes?: AgentToolMode[],
): void {
  if (entries.length > 0 || !requestedModes || requestedModes.length === 0) {
    return;
  }

  throw new EvalsError(
    `No compatible agent model entries for requested mode(s): ${requestedModes.join(
      ", ",
    )}. Non-CUA models require "dom" or "hybrid"; CUA-capable models are required for "cua".`,
  );
}

function resolveDefaultModelEntries(
  harness: Harness,
  effectiveCategory: string | null,
  isAgentCategory: boolean,
): AgentModelEntry[] {
  if (harness === "claude_code") {
    return readModelListEnv(
      "EVAL_CLAUDE_CODE_MODELS",
      DEFAULT_CLAUDE_CODE_MODELS,
    ).map((modelName) => ({
      modelName,
      mode: "hybrid",
      cua: false,
    }));
  }

  if (harness === "codex") {
    return readModelListEnv("EVAL_CODEX_MODELS", DEFAULT_CODEX_MODELS).map(
      (modelName) => ({
        modelName,
        mode: "hybrid",
        cua: false,
      }),
    );
  }

  return isAgentCategory
    ? getAgentModelEntries()
    : getModelList(effectiveCategory).map((modelName) => ({
        modelName,
        mode: "hybrid" as const,
        cua: false,
      }));
}

function readModelListEnv(
  key: string,
  fallback: AvailableModel[],
): AvailableModel[] {
  const raw = process.env[key];
  if (!raw) return fallback;
  const values = raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean) as AvailableModel[];
  return values.length > 0 ? values : fallback;
}

function resolveRequestedAgentModes(
  options: Pick<BenchPlanOptions, "agentMode" | "agentModes">,
): AgentToolMode[] | undefined {
  if (options.agentMode) return [options.agentMode];
  if (!options.agentModes || options.agentModes.length === 0) {
    return undefined;
  }
  return [...new Set(options.agentModes)];
}

function resolveAgentModeForModel(modelName: string): AgentToolMode {
  return inferDefaultStagehandAgentMode(modelName);
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
  const harness = options.harness ?? DEFAULT_BENCH_HARNESS;
  const environment = options.environment ?? "LOCAL";
  const useApi = Boolean(options.useApi);
  const toolSurface = resolveBenchRowToolSurface(
    harness,
    options.coreToolSurface,
  );
  const startupProfile = resolveBenchRowStartupProfile(
    harness,
    toolSurface,
    environment,
    options.coreStartupProfile,
  );
  const resolvedAgentMode = agentMode ?? (isCUA ? "cua" : undefined);
  const resolvedIsCUA = resolvedAgentMode ? resolvedAgentMode === "cua" : isCUA;
  const config = buildBenchHarnessConfig({
    harness,
    model: modelName,
    provider: options.provider,
    environment,
    useApi,
    agentMode: resolvedAgentMode,
    isCUA: resolvedIsCUA,
    toolSurface,
    startupProfile,
    dataset: options.datasetFilter,
  });

  return {
    harness,
    task: task.name,
    category: task.primaryCategory,
    taskKind: inferBenchTaskKind(task),
    model: modelName,
    provider: options.provider,
    environment,
    useApi,
    toolSurface,
    startupProfile,
    trial: 1,
    dataset: options.datasetFilter,
    params,
    agentMode: resolvedAgentMode,
    isCUA: resolvedIsCUA,
    config,
  };
}

function buildBenchHarnessConfig(input: {
  harness: Harness;
  model: AvailableModel;
  provider?: string;
  environment: "LOCAL" | "BROWSERBASE";
  useApi: boolean;
  agentMode?: AgentToolMode;
  isCUA?: boolean;
  toolSurface?: ToolSurface;
  startupProfile?: StartupProfile;
  dataset?: string;
}): BenchHarnessConfig {
  if (input.harness === "stagehand") {
    return {
      harness: "stagehand",
      model: input.model,
      provider: input.provider,
      environment: input.environment,
      useApi: input.useApi,
      agentMode: input.agentMode,
      isCUA: input.isCUA,
      toolSurface: input.toolSurface,
      startupProfile: input.startupProfile,
      dataset: input.dataset,
    };
  }

  return {
    harness: input.harness,
    model: input.model,
    provider: input.provider,
    environment: input.environment,
    useApi: input.useApi,
    toolSurface: input.toolSurface,
    startupProfile: input.startupProfile,
    dataset: input.dataset,
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

  if (options.harness === "claude_code" || options.harness === "codex") {
    if (suiteTestcases.remainingTasks.length > 0) {
      const unsupported = suiteTestcases.remainingTasks
        .map((task) => task.name)
        .sort()
        .join(", ");
      throw new EvalsError(
        `Harness "${options.harness}" only supports agent benchmark suites: agent/webvoyager, agent/onlineMind2Web, agent/webtailbench. Unsupported task(s): ${unsupported}.`,
      );
    }
    return allTestcases;
  }

  for (const entry of modelEntries) {
    for (const task of suiteTestcases.remainingTasks) {
      const model = entry.modelName as AvailableModel;
      const row = buildBenchMatrixRow(
        task,
        model,
        options,
        undefined,
        isAgentCategory && rowUsesStagehand(options)
          ? entry.mode === "cua"
          : undefined,
        isAgentCategory && rowUsesStagehand(options)
          ? (options.agentMode ?? entry.mode)
          : undefined,
      );
      const agentMode = row.agentMode;
      const includeStagehandAgentMode =
        isAgentCategory && rowUsesStagehand(options) && agentMode;
      allTestcases.push({
        input: {
          name: task.name,
          modelName: model,
          ...(includeStagehandAgentMode && {
            agentMode,
            isCUA: agentMode === "cua",
          }),
        },
        name: task.name,
        tags: [
          entry.modelName,
          ...(includeStagehandAgentMode ? [agentMode] : []),
          task.name,
          ...task.categories.map((x) => `category/${x}`),
          `harness/${row.harness}`,
        ],
        metadata: {
          model,
          test: task.name,
          tier: "bench",
          task: task.name,
          categories: task.categories,
          task_category: task.primaryCategory,
          harness: row.harness,
          environment: row.environment,
          api: row.useApi,
          provider: row.provider,
          toolSurface: row.toolSurface,
          startupProfile: row.startupProfile,
          ...buildToolMetadata(row),
          agentMode: row.agentMode,
        },
        expected: true,
      });
    }
  }

  return allTestcases;
}

function rowUsesStagehand(options: Pick<BenchPlanOptions, "harness">): boolean {
  return (options.harness ?? DEFAULT_BENCH_HARNESS) === "stagehand";
}

function resolveBenchRowToolSurface(
  harness: Harness,
  requested?: ToolSurface,
): ToolSurface | undefined {
  if (harness === "claude_code") {
    return resolveClaudeCodeToolSurface(requested);
  }
  if (harness === "codex") {
    return resolveCodexToolSurface(requested);
  }
  return requested;
}

function resolveBenchRowStartupProfile(
  harness: Harness,
  toolSurface: ToolSurface | undefined,
  environment: "LOCAL" | "BROWSERBASE",
  requested?: StartupProfile,
): StartupProfile | undefined {
  if (harness === "claude_code") {
    return resolveClaudeCodeStartupProfile(
      toolSurface ?? "browse_cli",
      environment,
      requested,
    );
  }
  if (harness === "codex") {
    return resolveCodexStartupProfile(
      toolSurface ?? "browse_cli",
      environment,
      requested,
    );
  }
  return requested;
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
  const isStagehand = rowUsesStagehand(options);
  const agentMode = isStagehand
    ? (options.agentMode ?? testcase.input.agentMode)
    : undefined;
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
  if (isStagehand && agentMode) tags.push(agentMode);
  const inputWithoutStagehandMode = { ...testcase.input };
  delete inputWithoutStagehandMode.agentMode;
  delete inputWithoutStagehandMode.isCUA;

  return {
    ...testcase,
    input: isStagehand
      ? {
          ...testcase.input,
          ...(agentMode && { agentMode, isCUA: agentMode === "cua" }),
        }
      : inputWithoutStagehandMode,
    tags: [...tags, `harness/${row.harness}`],
    metadata: {
      ...testcase.metadata,
      tier: "bench",
      task: task.name,
      category: task.categories[0] ?? task.primaryCategory,
      categories: task.categories,
      task_category: task.primaryCategory,
      harness: row.harness,
      environment: row.environment,
      api: row.useApi,
      provider: row.provider,
      toolSurface: row.toolSurface,
      startupProfile: row.startupProfile,
      ...buildToolMetadata(row),
      agentMode: row.agentMode,
    },
  };
}

function buildToolMetadata(row: BenchMatrixRow): Partial<Testcase["metadata"]> {
  if (
    (row.harness === "claude_code" || row.harness === "codex") &&
    row.toolSurface === "browse_cli"
  ) {
    return getBrowseCliToolMetadata();
  }
  return {};
}

import type { AvailableModel } from "stagehand-v3";
import { EvalsError } from "../errors.js";
import { buildOnlineMind2WebTestcases } from "../suites/onlineMind2Web.js";
import { buildWebTailBenchTestcases } from "../suites/webtailbench.js";
import { buildWebVoyagerTestcases } from "../suites/webvoyager.js";
import { buildOdysseysBenchTestcases } from "../suites/odysseysbench.js";
import { getModelList, type AgentModelEntry } from "../taskConfig.js";
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
import { resolveCodexStartupProfile, resolveCodexToolSurface } from "./codexToolAdapter.js";
import { resolveHermesStartupProfile, resolveHermesToolSurface } from "./hermesRunner.js";

const DEFAULT_CLAUDE_CODE_MODELS: AvailableModel[] = [
  "anthropic/claude-sonnet-4-6" as AvailableModel,
];
const DEFAULT_CODEX_MODELS: AvailableModel[] = ["openai/gpt-5.4-mini" as AvailableModel];
const DEFAULT_HERMES_MODELS: AvailableModel[] = [
  "anthropic/claude-opus-4.8" as AvailableModel,
  "moonshotai/kimi-k3" as AvailableModel,
];

export interface BenchPlanOptions {
  environment?: "LOCAL" | "BROWSERBASE";
  useApi?: boolean;
  modelOverride?: string;
  categoryFilter?: string;
  datasetFilter?: string;
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
  options: Pick<BenchPlanOptions, "categoryFilter" | "modelOverride" | "harness">,
): BenchModelResolution {
  const effectiveCategory = inferEffectiveBenchCategory(benchTasks, options.categoryFilter);
  const isAgentCategory =
    effectiveCategory === "agent" || effectiveCategory === "external_agent_benchmarks";
  const harness = options.harness ?? DEFAULT_BENCH_HARNESS;

  if (options.modelOverride) {
    return {
      effectiveCategory,
      isAgentCategory,
      modelEntries: [{ modelName: options.modelOverride, mode: "hybrid", cua: false }],
    };
  }

  return {
    effectiveCategory,
    isAgentCategory,
    modelEntries: resolveDefaultModelEntries(harness, effectiveCategory),
  };
}

function resolveDefaultModelEntries(
  harness: Harness,
  effectiveCategory: string | null,
): AgentModelEntry[] {
  if (harness === "claude_code") {
    return readModelListEnv("EVAL_CLAUDE_CODE_MODELS", DEFAULT_CLAUDE_CODE_MODELS).map(
      (modelName) => ({
        modelName,
        mode: "hybrid",
        cua: false,
      }),
    );
  }

  if (harness === "codex") {
    return readModelListEnv("EVAL_CODEX_MODELS", DEFAULT_CODEX_MODELS).map((modelName) => ({
      modelName,
      mode: "hybrid",
      cua: false,
    }));
  }

  if (harness === "hermes") {
    return readModelListEnv("EVAL_HERMES_MODELS", DEFAULT_HERMES_MODELS).map((modelName) => ({
      modelName,
      mode: "hybrid",
      cua: false,
    }));
  }

  return getModelList(effectiveCategory).map((modelName) => ({
    modelName,
    mode: "hybrid" as const,
    cua: false,
  }));
}

function readModelListEnv(key: string, fallback: AvailableModel[]): AvailableModel[] {
  const raw = process.env[key];
  if (!raw) return fallback;
  const values = raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean) as AvailableModel[];
  return values.length > 0 ? values : fallback;
}

export function inferBenchTaskKind(task: DiscoveredTask): BenchTaskKind {
  if (task.name.startsWith("agent/")) return "suite";
  if (isBenchTaskKind(task.primaryCategory)) return task.primaryCategory;
  return "act";
}

function isBenchTaskKind(value: string): value is BenchTaskKind {
  return value === "act" || value === "extract" || value === "observe" || value === "suite";
}

export function buildBenchMatrixRow(
  task: DiscoveredTask,
  modelName: AvailableModel,
  options: BenchPlanOptions,
  params?: Record<string, unknown>,
): BenchMatrixRow {
  const harness = options.harness ?? DEFAULT_BENCH_HARNESS;
  const environment = options.environment ?? "LOCAL";
  const useApi = Boolean(options.useApi);
  const toolSurface = resolveBenchRowToolSurface(harness, options.coreToolSurface);
  const startupProfile = resolveBenchRowStartupProfile(
    harness,
    toolSurface,
    environment,
    options.coreStartupProfile,
  );
  // Provider is derived from the model id ("provider/model") for metadata;
  // there is no independent provider selector.
  const provider = modelName.includes("/") ? modelName.slice(0, modelName.indexOf("/")) : undefined;
  const config = buildBenchHarnessConfig({
    harness,
    model: modelName,
    provider,
    environment,
    useApi,
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
    provider,
    environment,
    useApi,
    toolSurface,
    startupProfile,
    trial: 1,
    dataset: options.datasetFilter,
    params,
    config,
  };
}

function buildBenchHarnessConfig(input: {
  harness: Harness;
  model: AvailableModel;
  provider?: string;
  environment: "LOCAL" | "BROWSERBASE";
  useApi: boolean;
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
  // Agent suites run exclusively through the external harnesses — the
  // stagehand harness has no agent loop. A selection that leaves nothing to
  // run (suite name, agent category, dataset shorthand) errors with guidance
  // instead of planning zero cases; broad targets simply omit the suites.
  let plannedTasks = benchTasks;
  if ((options.harness ?? DEFAULT_BENCH_HARNESS) === "stagehand") {
    plannedTasks = benchTasks.filter((task) => inferBenchTaskKind(task) !== "suite");
    if (plannedTasks.length === 0 && benchTasks.length > 0) {
      throw new EvalsError(
        "Agent benchmark suites require an external harness. Re-run with --harness claude_code or --harness codex.",
      );
    }
  }

  const { modelEntries } = resolveBenchModelEntries(plannedTasks, options);

  const suiteTestcases = generateSuiteTestcases(plannedTasks, options, modelEntries);
  const allTestcases = [...suiteTestcases.testcases];

  if (
    options.harness === "claude_code" ||
    options.harness === "codex" ||
    options.harness === "hermes"
  ) {
    if (suiteTestcases.remainingTasks.length > 0) {
      const unsupported = suiteTestcases.remainingTasks
        .map((task) => task.name)
        .sort()
        .join(", ");
      throw new EvalsError(
        `Harness "${options.harness}" only supports agent benchmark suites: agent/webvoyager, agent/onlineMind2Web, agent/webtailbench, agent/odysseysbench. Unsupported task(s): ${unsupported}.`,
      );
    }
    return allTestcases;
  }

  for (const entry of modelEntries) {
    for (const task of suiteTestcases.remainingTasks) {
      const model = entry.modelName as AvailableModel;
      const row = buildBenchMatrixRow(task, model, options);
      allTestcases.push({
        input: {
          name: task.name,
          modelName: model,
        },
        name: task.name,
        tags: [
          entry.modelName,
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
        },
        expected: true,
      });
    }
  }

  return allTestcases;
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
  if (harness === "hermes") {
    return resolveHermesToolSurface(requested);
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
    return resolveClaudeCodeStartupProfile(toolSurface ?? "browse_cli", environment, requested);
  }
  if (harness === "codex") {
    return resolveCodexStartupProfile(toolSurface ?? "browse_cli", environment, requested);
  }
  if (harness === "hermes") {
    return resolveHermesStartupProfile(
      toolSurface ?? "hermes_browser_exec",
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
    "agent/odysseysbench": (models) => buildOdysseysBenchTestcases(models),
  };

  for (const [suiteName, builder] of Object.entries(suiteMap)) {
    const idx = remaining.findIndex((t) => t.name === suiteName);
    if (idx === -1) continue;
    const datasetName = suiteName.split("/").pop();
    if (!datasetFilter || datasetFilter === datasetName) {
      const task = remaining[idx];
      testcases.push(
        ...builder(modelEntries).map((testcase) => withBenchMetadata(testcase, task, options)),
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
  const row = buildBenchMatrixRow(task, testcase.input.modelName, options, testcase.input.params);
  const inputWithoutStagehandMode = { ...testcase.input };
  delete inputWithoutStagehandMode.agentMode;
  delete inputWithoutStagehandMode.isCUA;

  return {
    ...testcase,
    input: inputWithoutStagehandMode,
    // Suite builders still emit Stagehand agent-mode tags (dom/hybrid/cua);
    // stripping them keeps Braintrust tag filters from pooling external-
    // harness rows with historical Stagehand agent runs.
    tags: [
      ...testcase.tags.filter((tag) => tag !== "dom" && tag !== "hybrid" && tag !== "cua"),
      `harness/${row.harness}`,
    ],
    metadata: {
      ...testcase.metadata,
      tier: "bench",
      task: task.name,
      category: task.categories[0] ?? task.primaryCategory,
      categories: task.categories,
      // Preserve the dataset row's fine-grained category (e.g. webtailbench's
      // hotels_head / flights / jobs) that the suite builder set on the
      // testcase. Only fall back to the directory category when the row didn't
      // carry one — otherwise all three category fields collapse to "agent".
      task_category:
        (testcase.metadata.task_category as string | undefined) ??
        (row.params?.category as string | undefined) ??
        task.primaryCategory,
      harness: row.harness,
      environment: row.environment,
      api: row.useApi,
      provider: row.provider,
      toolSurface: row.toolSurface,
      startupProfile: row.startupProfile,
      ...buildToolMetadata(row),
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

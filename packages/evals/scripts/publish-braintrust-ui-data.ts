import { writeFile } from "node:fs/promises";
import {
  fetchExperimentData,
  type BenchCaseRow,
  type ExperimentData,
} from "../lib/braintrust-report.js";

type ParsedArgs = {
  experiment: string;
  project: string;
  key: string;
  experimentKeyPrefix: string;
  writeExperimentKey: boolean;
  dryRun: boolean;
  outputPath: string;
  datasetId: string;
};

type UpstashCredentials = {
  url: string;
  token: string;
};

type UiBenchmarkRow = {
  id: string;
  modelName: string;
  provider: string;
  providerKey: string;
  accuracy: number | null;
  speedSeconds: number | null;
  costPerTask: number | null;
  totalCost: number | null;
  timestamp?: number;
  experimentName?: string;
  experimentUrl?: string;
  projectName?: string;
  agentMode?: string;
};

type UiBenchmark = {
  key: string;
  label: string;
  rows: UiBenchmarkRow[];
};

type UiDataset = {
  id: string;
  timestamp: number;
  benchmarks: UiBenchmark[];
};

type BenchmarkUpdate = {
  key: string;
  label: string;
  experimentId: string;
  rows: UiBenchmarkRow[];
  summary: {
    passed: number;
    total: number;
    passPercent: number;
  };
};

type PublishResult = {
  dryRun: boolean;
  experimentName: string;
  projectName: string;
  keys: string[];
  benchmark: {
    key: string;
    label: string;
  };
  row: UiBenchmarkRow;
  rows: UiBenchmarkRow[];
  summary: {
    passed: number;
    total: number;
    passPercent: number;
  };
};

const DEFAULT_PROJECT = "stagehand";
const DEFAULT_KEY = "stagehand:evals:latest";
const DEFAULT_EXPERIMENT_KEY_PREFIX = "stagehand:evals:experiments";
const DEFAULT_DATASET_ID = "stagehand-evals";
const DEFAULT_OUTPUT_PATH = "evals-ui-data.json";

const BENCHMARK_LABELS = new Map<string, string>([
  ["custom", "Custom"],
  ["gaia", "GAIA"],
  ["onlineMind2Web", "Online Mind2Web"],
  ["online-mind2web", "Online Mind2Web"],
  ["onlinemind2web", "Online Mind2Web"],
  ["webtailbench", "WebTailBench"],
  ["webvoyager", "WebVoyager"],
]);

const PROVIDER_LABELS = new Map<string, string>([
  ["anthropic", "Anthropic"],
  ["browserbase", "Browserbase"],
  ["google", "Google"],
  ["moonshot", "Moonshot AI"],
  ["openai", "OpenAI"],
  ["xai", "xAI"],
]);

const PROVIDER_PREFIXES = [
  "anthropic",
  "browserbase",
  "google",
  "moonshot",
  "openai",
  "xai",
];

const COST_METRIC_KEYS = [
  "agent_cost_usd",
  "agent_total_cost_usd",
  "agent_estimated_cost_usd",
  "stagehand_agent_cost_usd",
  "stagehand_agent_total_cost_usd",
  "codex_cost_usd",
  "claude_code_cost_usd",
  "cost_usd",
  "total_cost_usd",
  "estimated_cost_usd",
  "cost",
  "price_usd",
];

const TESTED_RUN_INPUT_TOKEN_KEYS = [
  "agent_input_tokens",
  "total_input_tokens",
  "codex_input_tokens",
  "claude_code_input_tokens",
];

const TESTED_RUN_CACHED_INPUT_TOKEN_KEYS = [
  "agent_cached_input_tokens",
  "total_cached_input_tokens",
  "codex_cached_input_tokens",
  "claude_code_cache_read_input_tokens",
];

const TESTED_RUN_OUTPUT_TOKEN_KEYS = [
  "agent_output_tokens",
  "total_output_tokens",
  "codex_output_tokens",
  "claude_code_output_tokens",
];

const TESTED_RUN_INFERENCE_MS_KEYS = [
  "agent_inference_time_ms",
  "total_inference_time_ms",
  "codex_inference_time_ms",
  "claude_code_inference_time_ms",
];

type ModelPricing = {
  input: number;
  cachedInput?: number;
  output: number;
  longContext?: {
    thresholdTokens: number;
    input: number;
    cachedInput?: number;
    output: number;
  };
};

const MODEL_PRICING_USD_PER_1M_TOKENS = new Map<string, ModelPricing>([
  ["anthropic/claude-opus-4-7", { input: 5, cachedInput: 0.5, output: 25 }],
  ["claude-opus-4-7", { input: 5, cachedInput: 0.5, output: 25 }],
  ["anthropic/claude-opus-4-6", { input: 5, cachedInput: 0.5, output: 25 }],
  ["claude-opus-4-6", { input: 5, cachedInput: 0.5, output: 25 }],
  ["anthropic/claude-opus-4-5", { input: 5, cachedInput: 0.5, output: 25 }],
  ["claude-opus-4-5", { input: 5, cachedInput: 0.5, output: 25 }],
  ["anthropic/claude-sonnet-4-6", { input: 3, cachedInput: 0.3, output: 15 }],
  ["claude-sonnet-4-6", { input: 3, cachedInput: 0.3, output: 15 }],
  ["anthropic/claude-sonnet-4-5", { input: 3, cachedInput: 0.3, output: 15 }],
  ["claude-sonnet-4-5", { input: 3, cachedInput: 0.3, output: 15 }],
  ["anthropic/claude-haiku-4-5", { input: 1, cachedInput: 0.1, output: 5 }],
  ["claude-haiku-4-5", { input: 1, cachedInput: 0.1, output: 5 }],
  ["openai/gpt-5.5", { input: 5, cachedInput: 0.5, output: 30 }],
  ["gpt-5.5", { input: 5, cachedInput: 0.5, output: 30 }],
  ["openai/gpt-5.4", { input: 2.5, cachedInput: 0.25, output: 15 }],
  ["gpt-5.4", { input: 2.5, cachedInput: 0.25, output: 15 }],
  ["openai/gpt-5.4-mini", { input: 0.75, cachedInput: 0.075, output: 4.5 }],
  ["gpt-5.4-mini", { input: 0.75, cachedInput: 0.075, output: 4.5 }],
  [
    "google/gemini-3-flash-preview",
    { input: 0.5, cachedInput: 0.05, output: 3 },
  ],
  ["gemini-3-flash-preview", { input: 0.5, cachedInput: 0.05, output: 3 }],
  [
    "google/gemini-2.5-computer-use-preview-10-2025",
    {
      input: 1.25,
      output: 10,
      longContext: {
        thresholdTokens: 200_000,
        input: 2.5,
        output: 15,
      },
    },
  ],
  [
    "gemini-2.5-computer-use-preview-10-2025",
    {
      input: 1.25,
      output: 10,
      longContext: {
        thresholdTokens: 200_000,
        input: 2.5,
        output: 15,
      },
    },
  ],
  [
    "google/gemini-2.5-computer-use-preview",
    {
      input: 1.25,
      output: 10,
      longContext: {
        thresholdTokens: 200_000,
        input: 2.5,
        output: 15,
      },
    },
  ],
  [
    "gemini-2.5-computer-use-preview",
    {
      input: 1.25,
      output: 10,
      longContext: {
        thresholdTokens: 200_000,
        input: 2.5,
        output: 15,
      },
    },
  ],
]);

function usage(): string {
  return [
    "Usage:",
    "  publish-braintrust-ui-data.ts --experiment <name-or-id> [options]",
    "",
    "Options:",
    "  --experiment <value>             Braintrust experiment name or UUID",
    `  --project <name>                Braintrust project (default: ${DEFAULT_PROJECT})`,
    `  --key <key>                     Upstash Redis UI key (default: ${DEFAULT_KEY})`,
    `  --experiment-key-prefix <key>   Secondary key prefix (default: ${DEFAULT_EXPERIMENT_KEY_PREFIX})`,
    "  --no-experiment-key            Do not write <prefix>:<braintrust-id>",
    `  --dataset-id <id>               Top-level dataset id (default: ${DEFAULT_DATASET_ID})`,
    `  --out <path>                   Write generated UI payload (default: ${DEFAULT_OUTPUT_PATH})`,
    "  --dry-run                      Fetch and render without writing to Upstash",
  ].join("\n");
}

function parseArgs(argv: string[]): ParsedArgs {
  const args = [...argv];
  let experiment = "";
  let project = DEFAULT_PROJECT;
  let key = DEFAULT_KEY;
  let experimentKeyPrefix = DEFAULT_EXPERIMENT_KEY_PREFIX;
  let writeExperimentKey = true;
  let dryRun = false;
  let outputPath = DEFAULT_OUTPUT_PATH;
  let datasetId = DEFAULT_DATASET_ID;

  while (args.length > 0) {
    const arg = args.shift()!;
    switch (arg) {
      case "--help":
      case "-h":
        process.stdout.write(`${usage()}\n`);
        process.exit(0);
        break;
      case "--experiment":
        experiment = requireValue(args, arg);
        break;
      case "--project":
        project = requireValue(args, arg);
        break;
      case "--key":
        key = requireValue(args, arg);
        break;
      case "--experiment-key-prefix":
        experimentKeyPrefix = requireValue(args, arg);
        break;
      case "--no-experiment-key":
        writeExperimentKey = false;
        break;
      case "--dry-run":
        dryRun = true;
        break;
      case "--out":
        outputPath = requireValue(args, arg);
        break;
      case "--dataset-id":
        datasetId = requireValue(args, arg);
        break;
      default:
        throw new Error(`Unknown argument "${arg}".\n\n${usage()}`);
    }
  }

  if (!experiment) throw new Error("Missing required --experiment.");
  if (!project) throw new Error("Missing required --project.");
  if (!key) throw new Error("Missing required --key.");
  if (!datasetId) throw new Error("Missing required --dataset-id.");

  return {
    experiment,
    project,
    key,
    experimentKeyPrefix,
    writeExperimentKey,
    dryRun,
    outputPath,
    datasetId,
  };
}

function requireValue(args: string[], flag: string): string {
  const value = args.shift();
  if (!value) throw new Error(`Missing value for ${flag}`);
  return value;
}

function readEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function getUpstashCredentials(required: boolean): UpstashCredentials | null {
  const url = readEnv("UPSTASH_REDIS_REST_URL") ?? readEnv("KV_REST_API_URL");
  const token =
    readEnv("UPSTASH_REDIS_REST_TOKEN") ?? readEnv("KV_REST_API_TOKEN");

  if (url && token) {
    return {
      url: url.replace(/\/+$/, ""),
      token,
    };
  }

  if (required) {
    throw new Error(
      "Missing Upstash credentials. Set UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN or KV_REST_API_URL/KV_REST_API_TOKEN.",
    );
  }

  return null;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function readString(
  record: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }
  return undefined;
}

function readNumberOrNull(value: unknown): number | null {
  return readNumber(value) ?? null;
}

function slugify(value: string): string {
  return value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function humanize(value: string): string {
  const known = BENCHMARK_LABELS.get(value);
  if (known) return known;

  const words = value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[-_\s/]+/)
    .filter(Boolean);
  return words
    .map((word) =>
      word.length <= 3
        ? word.toUpperCase()
        : word.charAt(0).toUpperCase() + word.slice(1),
    )
    .join(" ");
}

function benchmarkSource(benchCase: BenchCaseRow): string | undefined {
  return (
    benchCase.dataset ??
    benchCase.suite.replace(/^agent\//, "") ??
    benchCase.category
  );
}

function isKnownBenchmarkKey(value: string): boolean {
  return BENCHMARK_LABELS.has(value);
}

function isPlainAgentRun(cases: BenchCaseRow[]): boolean {
  return cases.every(
    (benchCase) =>
      benchCase.category === "agent" || benchCase.suite.startsWith("agent/"),
  );
}

function uniqueValues(values: Array<string | undefined>): string[] {
  return [
    ...new Set(values.filter((value): value is string => Boolean(value))),
  ];
}

function inferBenchmark(cases: BenchCaseRow[]): { key: string; label: string } {
  const keys = uniqueValues(
    cases
      .map(benchmarkSource)
      .filter((source): source is string => Boolean(source))
      .map((source) => source.trim()),
  );

  const knownKeys = uniqueValues(keys.filter(isKnownBenchmarkKey));

  if (knownKeys.length === 1) {
    const key = knownKeys[0];
    return { key, label: BENCHMARK_LABELS.get(key) ?? humanize(key) };
  }

  if (knownKeys.length > 1) {
    throw new Error(
      `Expected one benchmark per Braintrust experiment, found: ${knownKeys.join(", ")}.`,
    );
  }

  if (isPlainAgentRun(cases)) {
    return { key: "custom", label: BENCHMARK_LABELS.get("custom")! };
  }

  if (keys.length === 0) {
    throw new Error(
      "Could not infer benchmark key from Braintrust bench cases.",
    );
  }

  if (keys.length > 1) {
    throw new Error(
      `Expected one benchmark per Braintrust experiment, found: ${keys.join(", ")}.`,
    );
  }

  const key = keys[0];
  return { key, label: BENCHMARK_LABELS.get(key) ?? humanize(key) };
}

function inferProviderFromModel(model: string): string | undefined {
  const normalized = model.toLowerCase();
  const slashPrefix = normalized.match(/^([a-z0-9_-]+)\//)?.[1];
  if (slashPrefix) return slugify(slashPrefix);
  if (/claude|anthropic/.test(normalized)) return "anthropic";
  if (/gpt|openai|o[1-9]/.test(normalized)) return "openai";
  if (/gemini|google/.test(normalized)) return "google";
  if (/grok|xai/.test(normalized)) return "xai";
  if (/kimi|moonshot/.test(normalized)) return "moonshot";
  return undefined;
}

function displayModelName(model: string): string {
  const [prefix, ...rest] = model.split("/");
  if (
    rest.length > 0 &&
    PROVIDER_PREFIXES.includes(prefix.trim().toLowerCase())
  ) {
    return rest.join("/");
  }
  return model;
}

function providerLabel(providerKey: string, explicitProvider?: string): string {
  if (explicitProvider) {
    return PROVIDER_LABELS.get(slugify(explicitProvider)) ?? explicitProvider;
  }
  return PROVIDER_LABELS.get(providerKey) ?? humanize(providerKey);
}

function inferModel(cases: BenchCaseRow[]): {
  modelName: string;
  provider: string;
  providerKey: string;
} {
  const models = uniqueValues(cases.map((benchCase) => benchCase.model));
  if (models.length === 0) {
    throw new Error("Could not infer model from Braintrust bench cases.");
  }
  if (models.length > 1) {
    throw new Error(
      `Expected one model per Braintrust experiment, found: ${models.join(", ")}.`,
    );
  }

  const model = models[0];
  const explicitProviders = uniqueValues(
    cases.map((benchCase) => benchCase.provider),
  );
  const explicitProvider =
    explicitProviders.length === 1 ? explicitProviders[0] : undefined;
  const providerKey = slugify(
    explicitProvider ?? inferProviderFromModel(model) ?? "unknown",
  );

  return {
    modelName: displayModelName(model),
    provider: providerLabel(providerKey, explicitProvider),
    providerKey,
  };
}

function modelGroupKey(benchCase: BenchCaseRow): string {
  return [
    benchCase.model ?? "unknown-model",
    benchCase.agentMode ?? "default",
  ].join("\0");
}

function groupCasesByModel(cases: BenchCaseRow[]): BenchCaseRow[][] {
  const groups = new Map<string, BenchCaseRow[]>();

  for (const benchCase of cases) {
    const key = modelGroupKey(benchCase);
    const group = groups.get(key) ?? [];
    group.push(benchCase);
    groups.set(key, group);
  }

  return [...groups.values()];
}

function mean(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value: number, places = 2): number {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

function caseCost(benchCase: BenchCaseRow): number | undefined {
  for (const key of COST_METRIC_KEYS) {
    const value = benchCase.metrics[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }

  const estimated = estimatedTokenCost(benchCase);
  if (estimated !== undefined) return estimated;

  const matched = Object.entries(benchCase.metrics).find(
    ([key, value]) =>
      /(cost|price|usd)/i.test(key) &&
      !/(verifier|evaluator|scorer|exactmatch|errormatch)/i.test(key) &&
      typeof value === "number" &&
      Number.isFinite(value),
  );

  return matched ? matched[1] : undefined;
}

function caseSpeedMs(benchCase: BenchCaseRow): number | undefined {
  return firstMetric(benchCase.metrics, TESTED_RUN_INFERENCE_MS_KEYS);
}

function firstMetric(
  metrics: Record<string, number>,
  keys: string[],
): number | undefined {
  for (const key of keys) {
    const value = metrics[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return undefined;
}

function modelPricing(model: string | undefined): ModelPricing | undefined {
  if (!model) return undefined;
  const normalized = model.trim().toLowerCase();
  return MODEL_PRICING_USD_PER_1M_TOKENS.get(normalized);
}

function estimatedTokenCost(benchCase: BenchCaseRow): number | undefined {
  const basePricing = modelPricing(benchCase.model);
  if (!basePricing) return undefined;

  // Only use metrics emitted by the tested agent/harness. Braintrust scorer
  // spans and task logs can contain verifier model usage, usually Gemini, and
  // must not be billed as the evaluated model.
  const inputTokens = firstMetric(
    benchCase.metrics,
    TESTED_RUN_INPUT_TOKEN_KEYS,
  );
  const cachedInputTokens =
    firstMetric(benchCase.metrics, TESTED_RUN_CACHED_INPUT_TOKEN_KEYS) ?? 0;
  const outputTokens = firstMetric(
    benchCase.metrics,
    TESTED_RUN_OUTPUT_TOKEN_KEYS,
  );

  if (inputTokens === undefined && outputTokens === undefined) {
    return undefined;
  }

  const billableInputTokens = Math.max(
    (inputTokens ?? 0) - cachedInputTokens,
    0,
  );
  const pricing =
    basePricing.longContext &&
    (inputTokens ?? 0) > basePricing.longContext.thresholdTokens
      ? basePricing.longContext
      : basePricing;
  const inputCost =
    (billableInputTokens * pricing.input +
      cachedInputTokens * (pricing.cachedInput ?? pricing.input)) /
    1_000_000;
  const outputCost = ((outputTokens ?? 0) * pricing.output) / 1_000_000;
  return inputCost + outputCost;
}

function experimentTimestamp(experiment: ExperimentData): number {
  const createdAt = experiment.createdAt
    ? Date.parse(experiment.createdAt)
    : Number.NaN;
  return Number.isFinite(createdAt) ? createdAt : Date.now();
}

function rowIdForModelGroup(
  experimentId: string,
  groups: BenchCaseRow[][],
  cases: BenchCaseRow[],
): string {
  if (groups.length === 1) return experimentId;

  const model = cases[0]?.model ?? "unknown-model";
  const agentMode = cases[0]?.agentMode ?? "default";
  return `${experimentId}:${slugify(model)}:${slugify(agentMode)}`;
}

function benchmarkRow(
  experiment: ExperimentData,
  cases: BenchCaseRow[],
  rowId: string,
): UiBenchmarkRow {
  const model = inferModel(cases);
  const total = cases.length;
  const passed = cases.filter((benchCase) => benchCase.success).length;
  const passPercent = total > 0 ? round((passed / total) * 100) : 0;
  const durations = cases
    .map((benchCase) => caseSpeedMs(benchCase) ?? benchCase.durationMs)
    .filter((value): value is number => typeof value === "number");
  const costs = cases
    .map(caseCost)
    .filter((value): value is number => typeof value === "number");
  const totalCost =
    costs.length > 0
      ? round(
          costs.reduce((sum, value) => sum + value, 0),
          6,
        )
      : null;
  const agentModes = uniqueValues(
    cases.map((benchCase) => benchCase.agentMode),
  );
  const agentMode = agentModes.length === 1 ? agentModes[0] : undefined;

  return {
    id: rowId,
    modelName: model.modelName,
    provider: model.provider,
    providerKey: model.providerKey,
    accuracy: passPercent,
    speedSeconds:
      durations.length > 0 ? round((mean(durations) ?? 0) / 1000) : null,
    costPerTask:
      totalCost !== null && total > 0 ? round(totalCost / total, 6) : null,
    totalCost,
    timestamp: experimentTimestamp(experiment),
    experimentName: experiment.experimentName,
    experimentUrl: experiment.experimentUrl,
    projectName: experiment.projectName,
    ...(agentMode ? { agentMode } : {}),
  };
}

function toBenchmarkUpdate(experiment: ExperimentData): BenchmarkUpdate {
  if (experiment.mode !== "bench" || experiment.benchCases.length === 0) {
    throw new Error(
      `Experiment "${experiment.experimentName}" is not a benchmark experiment.`,
    );
  }

  const benchmark = inferBenchmark(experiment.benchCases);
  const total = experiment.benchCases.length;
  const passed = experiment.benchCases.filter(
    (benchCase) => benchCase.success,
  ).length;
  const passPercent = total > 0 ? round((passed / total) * 100) : 0;
  const groups = groupCasesByModel(experiment.benchCases);

  return {
    key: benchmark.key,
    label: benchmark.label,
    experimentId: experiment.experimentId,
    rows: groups.map((cases) =>
      benchmarkRow(
        experiment,
        cases,
        rowIdForModelGroup(experiment.experimentId, groups, cases),
      ),
    ),
    summary: {
      passed,
      total,
      passPercent,
    },
  };
}

function sanitizeRow(value: unknown): UiBenchmarkRow | undefined {
  const record = asRecord(value);
  if (!record) return undefined;

  const id = readString(record, "id") ?? readString(record, "experimentId");
  if (!id) return undefined;

  const modelName = readString(record, "modelName");
  const providerKey = readString(record, "providerKey");
  const provider = readString(record, "provider");
  if (!modelName || !providerKey || !provider) return undefined;

  const row: UiBenchmarkRow = {
    id,
    modelName,
    provider,
    providerKey,
    accuracy: readNumberOrNull(record.accuracy),
    speedSeconds: readNumberOrNull(record.speedSeconds),
    costPerTask: readNumberOrNull(record.costPerTask),
    totalCost: readNumberOrNull(record.totalCost),
  };

  const timestamp = readNumber(record.timestamp);
  const experimentName = readString(record, "experimentName");
  const experimentUrl = readString(record, "experimentUrl");
  const projectName = readString(record, "projectName");
  const agentMode = readString(record, "agentMode");

  if (timestamp !== undefined) row.timestamp = timestamp;
  if (experimentName) row.experimentName = experimentName;
  if (experimentUrl) row.experimentUrl = experimentUrl;
  if (projectName) row.projectName = projectName;
  if (agentMode) row.agentMode = agentMode;

  return row;
}

function sanitizeBenchmark(value: unknown): UiBenchmark | undefined {
  const record = asRecord(value);
  if (!record) return undefined;

  const key = readString(record, "key");
  const label = readString(record, "label");
  const rows = Array.isArray(record.rows)
    ? record.rows
        .map(sanitizeRow)
        .filter((row): row is UiBenchmarkRow => Boolean(row))
    : [];

  if (!key || !label) return undefined;
  return { key, label, rows };
}

function sanitizeDataset(value: unknown, datasetId: string): UiDataset {
  const record = asRecord(value);
  if (!record) {
    throw new Error("Existing Upstash value is not a JSON object.");
  }

  if (!Array.isArray(record.benchmarks)) {
    throw new Error("Existing Upstash value does not contain benchmarks[].");
  }

  const benchmarks = record.benchmarks
    .map(sanitizeBenchmark)
    .filter((benchmark): benchmark is UiBenchmark => Boolean(benchmark));
  const id = readString(record, "id") ?? datasetId;
  const timestamp = readNumber(record.timestamp) ?? Date.now();

  return { id, timestamp, benchmarks };
}

function sortRows(rows: UiBenchmarkRow[]): UiBenchmarkRow[] {
  return [...rows].sort((a, b) => {
    const accuracyA = a.accuracy ?? -1;
    const accuracyB = b.accuracy ?? -1;
    if (accuracyA !== accuracyB) return accuracyB - accuracyA;

    const speedA = a.speedSeconds ?? Number.POSITIVE_INFINITY;
    const speedB = b.speedSeconds ?? Number.POSITIVE_INFINITY;
    if (speedA !== speedB) return speedA - speedB;

    const provider = a.provider.localeCompare(b.provider);
    if (provider !== 0) return provider;
    return a.modelName.localeCompare(b.modelName);
  });
}

function upsertResult(
  existing: UiDataset | null,
  update: BenchmarkUpdate,
  datasetId: string,
  timestamp: number,
): UiDataset {
  const updateRowIds = new Set(update.rows.map((row) => row.id));
  const isUpdatedExperimentRow = (row: UiBenchmarkRow): boolean =>
    updateRowIds.has(row.id) ||
    row.id === update.experimentId ||
    row.id.startsWith(`${update.experimentId}:`);

  const dataset: UiDataset = existing
    ? {
        id: existing.id,
        timestamp,
        benchmarks: existing.benchmarks.map((benchmark) => ({
          key: benchmark.key,
          label: benchmark.label,
          rows: benchmark.rows.filter((row) => !isUpdatedExperimentRow(row)),
        })),
      }
    : { id: datasetId, timestamp, benchmarks: [] };

  let benchmark = dataset.benchmarks.find(
    (candidate) => candidate.key === update.key,
  );
  if (!benchmark) {
    benchmark = { key: update.key, label: update.label, rows: [] };
    dataset.benchmarks.push(benchmark);
  }

  benchmark.label = update.label;
  benchmark.rows.push(...update.rows);
  dataset.benchmarks = dataset.benchmarks
    .filter((candidate) => candidate.rows.length > 0)
    .map((candidate) => ({
      ...candidate,
      rows: sortRows(candidate.rows),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  return dataset;
}

function experimentDataset(update: BenchmarkUpdate): UiDataset {
  return {
    id: update.experimentId,
    timestamp: update.rows[0]?.timestamp ?? Date.now(),
    benchmarks: [
      {
        key: update.key,
        label: update.label,
        rows: update.rows,
      },
    ],
  };
}

function parseRedisValue(value: unknown): unknown {
  if (typeof value !== "string") return value;

  try {
    return JSON.parse(value);
  } catch {
    throw new Error("Existing Upstash value is not valid JSON.");
  }
}

async function upstashGet(
  credentials: UpstashCredentials,
  key: string,
): Promise<unknown | null> {
  const response = await fetch(
    `${credentials.url}/get/${encodeURIComponent(key)}`,
    {
      headers: {
        Authorization: `Bearer ${credentials.token}`,
      },
    },
  );

  if (!response.ok) {
    throw new Error(
      `Upstash GET failed for "${key}" (${response.status}): ${await response.text()}`,
    );
  }

  const body = (await response.json()) as { result?: unknown };
  return body.result === undefined || body.result === null
    ? null
    : parseRedisValue(body.result);
}

async function upstashSetMany(
  credentials: UpstashCredentials,
  entries: Array<{ key: string; value: UiDataset }>,
): Promise<void> {
  const commands = entries.map(({ key, value }) => [
    "SET",
    key,
    JSON.stringify(value),
  ]);
  const response = await fetch(`${credentials.url}/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${credentials.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(commands),
  });

  if (!response.ok) {
    throw new Error(
      `Upstash pipeline failed (${response.status}): ${await response.text()}`,
    );
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const apiKey = readEnv("BRAINTRUST_API_KEY");
  if (!apiKey) throw new Error("Missing BRAINTRUST_API_KEY.");

  const credentials = getUpstashCredentials(!args.dryRun);
  const experiment = await fetchExperimentData(
    args.project,
    { label: args.experiment, experiment: args.experiment },
    { apiKey },
  );
  const update = toBenchmarkUpdate(experiment);

  let existing: UiDataset | null = null;
  if (credentials) {
    const currentValue = await upstashGet(credentials, args.key);
    if (currentValue !== null) {
      existing = sanitizeDataset(currentValue, args.datasetId);
    }
  }

  const now = Date.now();
  const merged = upsertResult(existing, update, args.datasetId, now);
  const keys = [args.key];
  const writes: Array<{ key: string; value: UiDataset }> = [
    { key: args.key, value: merged },
  ];

  if (args.writeExperimentKey) {
    const experimentKey = `${args.experimentKeyPrefix}:${update.experimentId}`;
    keys.push(experimentKey);
    writes.push({ key: experimentKey, value: experimentDataset(update) });
  }

  await writeFile(args.outputPath, `${JSON.stringify(merged, null, 2)}\n`);

  if (!args.dryRun) {
    if (!credentials) throw new Error("Missing Upstash credentials.");
    await upstashSetMany(credentials, writes);
  }

  const result: PublishResult = {
    dryRun: args.dryRun,
    experimentName: experiment.experimentName,
    projectName: experiment.projectName,
    keys,
    benchmark: {
      key: update.key,
      label: update.label,
    },
    row: update.rows[0]!,
    rows: update.rows,
    summary: update.summary,
  };

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});

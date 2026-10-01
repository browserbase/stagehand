/**
 * Shared argument parsing + option resolution for the evals CLI.
 *
 * Both the argv dispatch in cli.ts and the REPL tokenizer in repl.ts feed
 * tokens through parseRunArgs() here, and both resolve their final option
 * bundle through resolveRunOptions() — so flag semantics stay identical
 * regardless of entry point.
 *
 * Precedence (enforced by resolveRunOptions):
 *   1. CLI flags (highest)
 *   2. Benchmark shorthand derived overrides (b:/benchmark:<name>)
 *   3. STAGEHAND_BROWSER_TARGET (env-only fallback for --env)
 *   4. Config defaults (evals.config.json)
 *   5. Ambient EVAL_* env vars consumed downstream by runner/suites
 */
import { DEFAULT_BENCH_HARNESS, type Harness } from "../../framework/benchTypes.js";
import { TRACING_ENV_VARS } from "./config.js";
import { getBenchHarness, parseBenchHarness } from "../../framework/benchHarness.js";
import { isBenchSuite, listBenchSuites } from "../../framework/benchSuites.js";

export interface RunFlags {
  target?: string;
  trials?: number;
  concurrency?: number;
  env?: string;
  model?: string;
  api?: boolean;
  tool?: string;
  startup?: string;
  harness?: string;
  limit?: number;
  sample?: number;
  filter?: Array<[string, string]>;
  dryRun?: boolean;
  preview?: boolean;
  /** Emit the end-of-run summary as JSON instead of the table (CI). */
  json?: boolean;
  /** Stream every row's log lines above the board (`-v`). */
  verbose?: boolean;
  /** Stream only this row's log lines (case id prefix, e.g. `47e314cc`). */
  follow?: string;
  /**
   * Rubric success mode for the verifier — outcome | process | both.
   *   outcome (default): binary EvaluationResult.outcomeSuccess.
   *   process: EvaluationResult.processScore ≥ threshold.
   *   both: outcome AND process.
   * Plumbed to bench tasks via the EVAL_SUCCESS_MODE env override.
   */
  success?: SuccessMode;
}

export type SuccessMode = "outcome" | "process" | "both";
const SUCCESS_MODES: ReadonlySet<SuccessMode> = new Set<SuccessMode>([
  "outcome",
  "process",
  "both",
]);

export interface ConfigDefaults {
  env?: string;
  trials?: number;
  concurrency?: number;
  model?: string | null;
  api?: boolean;
  verbose?: boolean | null;
  /** Default bench harness (config v2 `defaults.harness`). */
  harness?: string | null;
  /** Default rubric success mode (config v2 `defaults.successMode`). */
  successMode?: string | null;
}

/**
 * Config v2 sections that feed run resolution. Each key has an env twin and
 * the env always wins (same rule as `tracing`), so they resolve to env
 * overrides here rather than new code paths in the planner.
 */
export interface RunConfigSections {
  benchmarks?: Record<string, { limit?: number | null }>;
  harnesses?: Record<string, { models?: string[] | null; tool?: string | null }>;
  providers?: Record<string, { concurrency?: number | null }>;
  verifier?: { model?: string | null; maxUnverifiableCriteria?: number | null };
  campaign?: { tag?: string | null };
}

/** Env twin of `campaign.tag`; the runner stamps it on experiment metadata. */
export const CAMPAIGN_TAG_ENV = "EVAL_CAMPAIGN_TAG";

export interface ResolvedRunOptions {
  target?: string;
  normalizedTarget?: string;
  trials: number;
  concurrency: number;
  environment: "LOCAL" | "BROWSERBASE";
  model?: string;
  useApi: boolean;
  coreToolSurface?: string;
  coreStartupProfile?: string;
  harness: Harness;
  datasetFilter?: string;
  /** Rubric success mode forwarded to bench tasks via EVAL_SUCCESS_MODE. */
  successMode: SuccessMode;
  envOverrides: Record<string, string>;
  dryRun: boolean;
  preview: boolean;
  /** End-of-run summary as JSON (see framework/runSummary.ts). Optional so existing callers need no change. */
  json?: boolean;
  /** Per-provider semaphore widths from config (`providers.<p>.concurrency`); env layers on top. */
  providerConcurrency?: Record<string, number>;
  /** `-v`: stream every row's log lines above the board. */
  verbose: boolean;
  /** `--follow <id>`: stream only rows whose case id starts with this. */
  follow?: string;
}

const BOOLEAN_FLAGS = new Set(["api", "dry-run", "preview", "json", "verbose"]);
const VALUE_FLAGS = new Set([
  "trials",
  "concurrency",
  "limit",
  "sample",
  "env",
  "model",
  "tool",
  "startup",
  "harness",
  "filter",
  "success",
  "follow",
]);

const FLAG_ALIASES: Record<string, string> = {
  v: "verbose",
  t: "trials",
  c: "concurrency",
  e: "env",
  m: "model",
  l: "limit",
  s: "sample",
  f: "filter",
  d: "detailed",
};

function parsePositiveInteger(raw: string, optionName: string): number {
  if (!/^[0-9]+$/.test(raw)) {
    throw new Error(`--${optionName} must be a positive integer`);
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`--${optionName} must be a positive integer`);
  }
  return parsed;
}

function normalizeEnvironment(raw: string, source: string): "local" | "browserbase" {
  const normalized = raw.toLowerCase();
  if (normalized !== "local" && normalized !== "browserbase") {
    throw new Error(`${source} must be "local" or "browserbase"`);
  }
  return normalized;
}

function parseFilter(raw: string): [string, string] {
  const eq = raw.indexOf("=");
  if (eq <= 0 || eq === raw.length - 1) {
    throw new Error('--filter must be in "key=value" form');
  }

  const key = raw.slice(0, eq);
  const value = raw.slice(eq + 1);
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(key)) {
    throw new Error(
      "--filter key must start with a letter and contain only letters, numbers, or underscores",
    );
  }

  return [key, value];
}

function readPositiveInteger(value: number | undefined | null, source: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${source} must be a positive integer`);
  }
  return value;
}

/**
 * Parse an argv or REPL-token stream into a RunFlags structure. The first
 * non-flag token becomes `target`; later positional args are rejected.
 */
export function parseRunArgs(tokens: string[]): RunFlags {
  const flags: RunFlags = {};
  const filters: Array<[string, string]> = [];

  let i = 0;
  while (i < tokens.length) {
    const tok = tokens[i];

    if (tok.startsWith("-")) {
      const rawName = tok.replace(/^--?/, "");
      const name = FLAG_ALIASES[rawName] ?? rawName;

      if (BOOLEAN_FLAGS.has(name)) {
        if (name === "api") flags.api = true;
        else if (name === "dry-run") flags.dryRun = true;
        else if (name === "preview") flags.preview = true;
        else if (name === "json") flags.json = true;
        else if (name === "verbose") flags.verbose = true;
        i++;
        continue;
      }

      if (!VALUE_FLAGS.has(name)) {
        throw new Error(`Unknown option "${tok}"`);
      }

      const value = tokens[i + 1];
      if (value === undefined || value.startsWith("-")) {
        throw new Error(`Missing value for "${tok}"`);
      }

      switch (name) {
        case "trials":
          flags.trials = parsePositiveInteger(value, name);
          break;
        case "concurrency":
          flags.concurrency = parsePositiveInteger(value, name);
          break;
        case "limit":
          flags.limit = parsePositiveInteger(value, name);
          break;
        case "sample":
          flags.sample = parsePositiveInteger(value, name);
          break;
        case "env":
          flags.env = normalizeEnvironment(value, "--env");
          break;
        case "model":
          flags.model = value;
          break;
        case "tool":
          flags.tool = value;
          break;
        case "startup":
          flags.startup = value;
          break;
        case "harness":
          flags.harness = value;
          break;
        case "follow":
          flags.follow = value;
          break;
        case "filter": {
          filters.push(parseFilter(value));
          break;
        }
        case "success": {
          const v = value.toLowerCase() as SuccessMode;
          if (!SUCCESS_MODES.has(v)) {
            throw new Error(`--success must be one of: outcome, process, both (got "${value}")`);
          }
          flags.success = v;
          break;
        }
        default:
          break;
      }
      i += 2;
      continue;
    }

    if (flags.target === undefined) {
      flags.target = tok;
    } else {
      throw new Error(`Unexpected argument "${tok}"`);
    }
    i++;
  }

  if (filters.length > 0) flags.filter = filters;

  if (flags.dryRun && flags.preview) {
    throw new Error(
      "--preview and --dry-run are mutually exclusive\n  Use --dry-run for JSON output\n  Use --preview for the human-readable table",
    );
  }

  return flags;
}

/**
 * Normalize a run target. Returns the target to hand to resolveTarget()
 * along with any env var overrides + datasetFilter needed for the
 * downstream runner / suites.
 *
 *   "all" → undefined (resolveTarget treats undefined as all bench tasks)
 *   "b:webvoyager" / "benchmark:webvoyager" → "agent/webvoyager" + EVAL_DATASET + EVAL_WEBVOYAGER_*
 *   other → passed through unchanged
 */
export function applyBenchmarkShorthand(
  target: string | undefined,
  flags: RunFlags,
  benchmarks: RunConfigSections["benchmarks"] = {},
  env: NodeJS.ProcessEnv = process.env,
): {
  target: string | undefined;
  datasetFilter?: string;
  envOverrides: Record<string, string>;
} {
  const envOverrides: Record<string, string> = {};

  if (target === "all") {
    return { target: undefined, envOverrides };
  }

  if (!target) return { target, envOverrides };

  const match = target.match(/^(b|benchmark):(.+)$/);
  if (!match) return { target, envOverrides };

  const benchmarkName = match[2];

  if (!isBenchSuite(benchmarkName)) {
    throw new Error(
      `Unknown benchmark "${benchmarkName}". Supported: ${listBenchSuites().join(", ")}.`,
    );
  }

  const upper = benchmarkName.toUpperCase();
  envOverrides.EVAL_DATASET = benchmarkName;
  const limitEnv = `EVAL_${upper}_LIMIT`;
  const configLimit = benchmarks[benchmarkName]?.limit;
  if (flags.limit !== undefined) {
    envOverrides.EVAL_MAX_K = String(flags.limit);
    envOverrides[limitEnv] = String(flags.limit);
  } else if (
    typeof configLimit === "number" &&
    configLimit > 0 &&
    !env[limitEnv]?.trim() &&
    !env.EVAL_MAX_K?.trim()
  ) {
    // benchmarks.<suite>.limit: honored only when neither --limit nor the
    // env twins are set, so a shell export still wins over the config file.
    envOverrides[limitEnv] = String(configLimit);
  }
  if (flags.sample !== undefined) {
    envOverrides[`EVAL_${upper}_SAMPLE`] = String(flags.sample);
  }
  for (const [key, value] of flags.filter ?? []) {
    envOverrides[`EVAL_${upper}_${key.toUpperCase()}`] = value;
  }

  return {
    target: `agent/${benchmarkName}`,
    datasetFilter: benchmarkName,
    envOverrides,
  };
}

/**
 * Resolve RunFlags + config defaults + process.env into the final
 * ResolvedRunOptions bundle passed to runCommand. Applies precedence in a
 * single place so the order is greppable and testable.
 */
export interface CoreConfig {
  tool?: string;
  startup?: string;
}

/** Persisted trace-sink defaults (evals.config.json `tracing`). Env wins. */
export interface TracingConfig {
  transport?: string;
  braintrustProject?: string;
  langsmithProject?: string;
}

export function resolveRunOptions(
  flags: RunFlags,
  defaults: ConfigDefaults,
  env: NodeJS.ProcessEnv,
  core: CoreConfig = {},
  tracing: TracingConfig = {},
  sections: RunConfigSections = {},
): ResolvedRunOptions {
  const parseIntEnv = (value: string | undefined): number | undefined => {
    if (!value) return undefined;
    return parsePositiveInteger(value, "environment value");
  };

  const rawEnv =
    flags.env ?? env.STAGEHAND_BROWSER_TARGET ?? defaults.env ?? env.EVAL_ENV ?? "local";
  const envLower = normalizeEnvironment(rawEnv, "Environment");
  const environment = envLower === "browserbase" ? "BROWSERBASE" : "LOCAL";

  const {
    target,
    datasetFilter: shorthandDatasetFilter,
    envOverrides,
  } = applyBenchmarkShorthand(flags.target, flags, sections.benchmarks, env);

  const model = flags.model ?? defaults.model ?? env.EVAL_MODEL_OVERRIDE ?? undefined;
  const useApi = flags.api ?? defaults.api ?? (env.USE_API ?? "").toLowerCase() === "true";
  const trials =
    flags.trials ??
    readPositiveInteger(defaults.trials, "defaults.trials") ??
    parseIntEnv(env.EVAL_TRIAL_COUNT) ??
    3;
  const concurrency =
    flags.concurrency ??
    readPositiveInteger(defaults.concurrency, "defaults.concurrency") ??
    parseIntEnv(env.EVAL_MAX_CONCURRENCY) ??
    3;

  const datasetFilter = shorthandDatasetFilter ?? env.EVAL_DATASET ?? undefined;
  const harness = parseBenchHarness(
    flags.harness ?? defaults.harness?.trim() ?? DEFAULT_BENCH_HARNESS,
  );
  const harnessConfig = sections.harnesses?.[harness];

  // harnesses.<h>.models → EVAL_<H>_MODELS when the env twin is unset. The
  // planner keeps reading env, so the precedence stays flag → env → config.
  const harnessModels = harnessConfig?.models?.map((model) => model.trim()).filter(Boolean);
  const modelsEnv = `EVAL_${harness.toUpperCase()}_MODELS`;
  // Only harnesses with a default model list read the env twin; the rest
  // (stagehand) pick models per task category.
  if (
    getBenchHarness(harness).defaultModels &&
    harnessModels &&
    harnessModels.length > 0 &&
    !env[modelsEnv]?.trim()
  ) {
    envOverrides[modelsEnv] = harnessModels.join(",");
  }

  // verifier.* and campaign.tag follow the tracing rule: persisted default,
  // env wins.
  const verifierModel = sections.verifier?.model?.trim();
  if (verifierModel && !env.EVAL_VERIFIER_MODEL?.trim()) {
    envOverrides.EVAL_VERIFIER_MODEL = verifierModel;
  }
  const maxUnverifiable = sections.verifier?.maxUnverifiableCriteria;
  if (
    typeof maxUnverifiable === "number" &&
    maxUnverifiable >= 0 &&
    !env.EVAL_MAX_UNVERIFIABLE_CRITERIA?.trim()
  ) {
    envOverrides.EVAL_MAX_UNVERIFIABLE_CRITERIA = String(maxUnverifiable);
  }
  const campaignTag = sections.campaign?.tag?.trim();
  if (campaignTag && !env[CAMPAIGN_TAG_ENV]?.trim()) {
    envOverrides[CAMPAIGN_TAG_ENV] = campaignTag;
  }

  const providerConcurrency = Object.fromEntries(
    Object.entries(sections.providers ?? {}).flatMap(([provider, section]) => {
      const width = section?.concurrency;
      return typeof width === "number" && Number.isInteger(width) && width > 0
        ? [[provider.toLowerCase(), width]]
        : [];
    }),
  );

  // Trace-sink defaults from config are applied as env overrides only when the
  // corresponding env var is unset, so a shell export or CI secret always wins.
  for (const key of Object.keys(TRACING_ENV_VARS) as Array<keyof TracingConfig>) {
    const value = tracing[key]?.trim();
    const envName = TRACING_ENV_VARS[key];
    if (value && !env[envName]?.trim()) envOverrides[envName] = value;
  }

  envOverrides.EVAL_ENV = environment;
  envOverrides.USE_API = String(Boolean(useApi));
  envOverrides.EVAL_TRIAL_COUNT = String(trials);
  envOverrides.EVAL_MAX_CONCURRENCY = String(concurrency);
  if (model !== undefined) {
    envOverrides.EVAL_MODEL_OVERRIDE = model;
  }

  // Success mode resolves from --success first, then EVAL_SUCCESS_MODE env,
  // then "outcome".
  const envSuccess = (env.EVAL_SUCCESS_MODE ?? "").toLowerCase();
  const configSuccess = (defaults.successMode ?? "").toLowerCase();
  const successMode: SuccessMode =
    flags.success ??
    (SUCCESS_MODES.has(envSuccess as SuccessMode)
      ? (envSuccess as SuccessMode)
      : SUCCESS_MODES.has(configSuccess as SuccessMode)
        ? (configSuccess as SuccessMode)
        : "outcome");
  envOverrides.EVAL_SUCCESS_MODE = successMode;

  return {
    target: flags.target,
    normalizedTarget: target,
    trials,
    concurrency,
    environment,
    model: model ?? undefined,
    useApi: Boolean(useApi),
    // harnesses.<h>.tool is the per-harness --tool default; core.tool stays
    // the fallback so core-tier runs keep their own setting.
    coreToolSurface: flags.tool ?? harnessConfig?.tool?.trim() ?? core.tool,
    coreStartupProfile: flags.startup ?? core.startup,
    harness,
    datasetFilter,
    successMode,
    envOverrides,
    dryRun: flags.dryRun ?? false,
    preview: flags.preview ?? false,
    json: flags.json ?? false,
    ...(Object.keys(providerConcurrency).length > 0 && { providerConcurrency }),
    verbose: flags.verbose ?? defaults.verbose ?? false,
    ...(flags.follow && { follow: flags.follow }),
  };
}

/**
 * Env vars a run stamps onto `process.env` from the inside (see
 * `framework/trajectoryGroup.ts`). Their values are only known once the run has
 * generated its testcases, so they can't be passed as `overrides` — but the REPL
 * still must not leak them, so they are restored even though we never set them.
 */
const RUN_STAMPED_ENV_KEYS = [
  "EVAL_TRAJECTORY_GROUP",
  "EVAL_EXPERIMENT_NAME",
  "EVAL_TRAJECTORY_MODEL",
];

/**
 * Set env overrides for the duration of `fn` and restore prior values in
 * a `finally` block. Needed because the REPL is a long-lived process and
 * suites/*.ts read env vars directly — unscoped mutations would leak
 * between REPL commands.
 */
export async function withEnvOverrides<T>(
  overrides: Record<string, string>,
  fn: () => Promise<T>,
): Promise<T> {
  // Restore the run-stamped keys too, not just the ones we set: otherwise a run's
  // trajectory group survives the command that created it.
  const keys = [...new Set([...Object.keys(overrides), ...RUN_STAMPED_ENV_KEYS])];
  const previous: Record<string, string | undefined> = {};
  for (const key of keys) {
    previous[key] = process.env[key];
    if (key in overrides) process.env[key] = overrides[key];
  }
  try {
    return await fn();
  } finally {
    for (const key of keys) {
      const prev = previous[key];
      if (prev === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = prev;
      }
    }
  }
}

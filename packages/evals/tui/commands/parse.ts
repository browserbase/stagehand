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
import {
  DEFAULT_BENCH_HARNESS,
  parseBenchHarness,
  type Harness,
} from "../../framework/benchTypes.js";
import type { AgentToolMode } from "@browserbasehq/stagehand";

export interface RunFlags {
  target?: string;
  trials?: number;
  concurrency?: number;
  env?: string;
  model?: string;
  provider?: string;
  api?: boolean;
  tool?: string;
  startup?: string;
  harness?: string;
  agentMode?: string;
  agentModes?: AgentToolMode[];
  limit?: number;
  sample?: number;
  filter?: Array<[string, string]>;
  dryRun?: boolean;
  preview?: boolean;
  /** Spawn the pre-refactor index.eval.ts runner instead of the unified path. */
  legacy?: boolean;
}

export interface ConfigDefaults {
  env?: string;
  trials?: number;
  concurrency?: number;
  provider?: string | null;
  model?: string | null;
  api?: boolean;
  verbose?: boolean | null;
  agentModes?: AgentToolMode[] | null;
}

export interface ResolvedRunOptions {
  target?: string;
  normalizedTarget?: string;
  trials: number;
  concurrency: number;
  environment: "LOCAL" | "BROWSERBASE";
  model?: string;
  provider?: string;
  useApi: boolean;
  coreToolSurface?: string;
  coreStartupProfile?: string;
  harness: Harness;
  agentMode?: AgentToolMode;
  agentModes?: AgentToolMode[];
  datasetFilter?: string;
  envOverrides: Record<string, string>;
  dryRun: boolean;
  preview: boolean;
  verbose: boolean;
}

/**
 * Suites wired into the unified runner. GAIA remains legacy-only;
 * WebBench never had a unified suite implementation.
 */
const SUPPORTED_BENCHMARKS = new Set([
  "webvoyager",
  "onlineMind2Web",
  "webtailbench",
]);

const LEGACY_ONLY_BENCHMARKS = new Set(["gaia", "osworld"]);

const BOOLEAN_FLAGS = new Set(["api", "dry-run", "preview", "legacy"]);
const VALUE_FLAGS = new Set([
  "trials",
  "concurrency",
  "limit",
  "sample",
  "env",
  "model",
  "provider",
  "tool",
  "startup",
  "harness",
  "agent-mode",
  "agent-modes",
  "filter",
]);

const FLAG_ALIASES: Record<string, string> = {
  t: "trials",
  c: "concurrency",
  e: "env",
  m: "model",
  p: "provider",
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

function normalizeEnvironment(
  raw: string,
  source: string,
): "local" | "browserbase" {
  const normalized = raw.toLowerCase();
  if (normalized !== "local" && normalized !== "browserbase") {
    throw new Error(`${source} must be "local" or "browserbase"`);
  }
  return normalized;
}

function normalizeAgentMode(raw: string): AgentToolMode {
  if (raw !== "dom" && raw !== "hybrid" && raw !== "cua") {
    throw new Error('--agent-mode must be "dom", "hybrid", or "cua"');
  }
  return raw;
}

export function parseAgentModes(raw: string): AgentToolMode[] {
  const modes = raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map(normalizeAgentMode);

  if (modes.length === 0) {
    throw new Error("--agent-modes must include at least one mode");
  }

  return [...new Set(modes)];
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

function readPositiveInteger(
  value: number | undefined | null,
  source: string,
): number | undefined {
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
        else if (name === "legacy") flags.legacy = true;
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
        case "provider":
          flags.provider = value;
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
        case "agent-mode":
          flags.agentMode = normalizeAgentMode(value);
          break;
        case "agent-modes":
          flags.agentModes = parseAgentModes(value);
          break;
        case "filter": {
          filters.push(parseFilter(value));
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

  if (LEGACY_ONLY_BENCHMARKS.has(benchmarkName)) {
    if (!flags.legacy) {
      throw new Error(
        `Benchmark "${benchmarkName}" is legacy-only. Use --legacy or choose one of: ${[...SUPPORTED_BENCHMARKS].join(", ")}.`,
      );
    }
  }

  if (
    !SUPPORTED_BENCHMARKS.has(benchmarkName) &&
    !LEGACY_ONLY_BENCHMARKS.has(benchmarkName)
  ) {
    throw new Error(
      `Unknown benchmark "${benchmarkName}". Supported: ${[...SUPPORTED_BENCHMARKS].join(", ")}.`,
    );
  }

  const upper = benchmarkName.toUpperCase();
  envOverrides.EVAL_DATASET = benchmarkName;
  if (flags.limit !== undefined) {
    envOverrides.EVAL_MAX_K = String(flags.limit);
    envOverrides[`EVAL_${upper}_LIMIT`] = String(flags.limit);
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

export function resolveRunOptions(
  flags: RunFlags,
  defaults: ConfigDefaults,
  env: NodeJS.ProcessEnv,
  core: CoreConfig = {},
): ResolvedRunOptions {
  const parseIntEnv = (value: string | undefined): number | undefined => {
    if (!value) return undefined;
    return parsePositiveInteger(value, "environment value");
  };

  const rawEnv =
    flags.env ??
    env.STAGEHAND_BROWSER_TARGET ??
    defaults.env ??
    env.EVAL_ENV ??
    "local";
  const envLower = normalizeEnvironment(rawEnv, "Environment");
  const environment = envLower === "browserbase" ? "BROWSERBASE" : "LOCAL";

  const {
    target,
    datasetFilter: shorthandDatasetFilter,
    envOverrides,
  } = applyBenchmarkShorthand(flags.target, flags);

  const model =
    flags.model ?? defaults.model ?? env.EVAL_MODEL_OVERRIDE ?? undefined;
  const provider =
    flags.provider ?? defaults.provider ?? env.EVAL_PROVIDER ?? undefined;
  const useApi =
    flags.api ?? defaults.api ?? (env.USE_API ?? "").toLowerCase() === "true";
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
  const harness = parseBenchHarness(flags.harness ?? DEFAULT_BENCH_HARNESS);
  const agentMode = flags.agentMode
    ? normalizeAgentMode(flags.agentMode)
    : undefined;
  const agentModes = agentMode
    ? undefined
    : (flags.agentModes ?? defaults.agentModes ?? undefined);

  envOverrides.EVAL_ENV = environment;
  envOverrides.USE_API = String(Boolean(useApi));
  envOverrides.EVAL_TRIAL_COUNT = String(trials);
  envOverrides.EVAL_MAX_CONCURRENCY = String(concurrency);
  if (provider !== undefined) {
    envOverrides.EVAL_PROVIDER = provider;
  }
  if (model !== undefined) {
    envOverrides.EVAL_MODEL_OVERRIDE = model;
  }

  return {
    target: flags.target,
    normalizedTarget: target,
    trials,
    concurrency,
    environment,
    model: model ?? undefined,
    provider: provider ?? undefined,
    useApi: Boolean(useApi),
    coreToolSurface: flags.tool ?? core.tool,
    coreStartupProfile: flags.startup ?? core.startup,
    harness,
    agentMode,
    agentModes,
    datasetFilter,
    envOverrides,
    dryRun: flags.dryRun ?? false,
    preview: flags.preview ?? false,
    verbose: defaults.verbose ?? false,
  };
}

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
  const keys = Object.keys(overrides);
  const previous: Record<string, string | undefined> = {};
  for (const key of keys) {
    previous[key] = process.env[key];
    process.env[key] = overrides[key];
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

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
  limit?: number;
  sample?: number;
  filter?: Array<[string, string]>;
  dryRun?: boolean;
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
  datasetFilter?: string;
  envOverrides: Record<string, string>;
  dryRun: boolean;
  verbose: boolean;
}

/**
 * Suites wired into framework/runner.ts. `webbench` and `osworld` were
 * advertised by the legacy CLI but never made it to the unified path.
 */
const SUPPORTED_BENCHMARKS = new Set([
  "gaia",
  "webvoyager",
  "onlineMind2Web",
  "webtailbench",
]);

const RETIRED_BENCHMARKS = new Set(["webbench", "osworld"]);

const BOOLEAN_FLAGS = new Set(["api", "dry-run", "legacy"]);
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

/**
 * Parse an argv or REPL-token stream into a RunFlags structure. The first
 * non-flag token becomes `target`; later positional args are ignored.
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
        else if (name === "legacy") flags.legacy = true;
        i++;
        continue;
      }

      if (!VALUE_FLAGS.has(name)) {
        throw new Error(`Unknown option "${tok}"`);
      }

      const value = tokens[i + 1];
      if (value === undefined || value.startsWith("-")) {
        i++;
        continue;
      }

      switch (name) {
        case "trials":
          flags.trials = parseInt(value, 10);
          break;
        case "concurrency":
          flags.concurrency = parseInt(value, 10);
          break;
        case "limit":
          flags.limit = parseInt(value, 10);
          break;
        case "sample":
          flags.sample = parseInt(value, 10);
          break;
        case "env":
          flags.env = value.toLowerCase();
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
        case "filter": {
          const eq = value.indexOf("=");
          if (eq > 0) {
            filters.push([value.slice(0, eq), value.slice(eq + 1)]);
          }
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
    }
    i++;
  }

  if (filters.length > 0) flags.filter = filters;
  return flags;
}

/**
 * Normalize a run target. Returns the target to hand to resolveTarget()
 * along with any env var overrides + datasetFilter needed for the
 * downstream runner / suites.
 *
 *   "all" → undefined (resolveTarget treats undefined as all bench tasks)
 *   "b:gaia" / "benchmark:gaia" → "agent/gaia" + EVAL_DATASET + EVAL_GAIA_*
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

  if (RETIRED_BENCHMARKS.has(benchmarkName)) {
    throw new Error(
      `Benchmark "${benchmarkName}" was removed from the unified runner. Supported: ${[...SUPPORTED_BENCHMARKS].join(", ")}.`,
    );
  }

  if (!SUPPORTED_BENCHMARKS.has(benchmarkName)) {
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
    const parsed = parseInt(value, 10);
    return Number.isNaN(parsed) ? undefined : parsed;
  };

  const envLower =
    flags.env ??
    env.STAGEHAND_BROWSER_TARGET?.toLowerCase() ??
    defaults.env ??
    env.EVAL_ENV?.toLowerCase() ??
    "local";
  const environment = envLower === "browserbase" ? "BROWSERBASE" : "LOCAL";

  const {
    target,
    datasetFilter: shorthandDatasetFilter,
    envOverrides,
  } = applyBenchmarkShorthand(
    flags.target,
    flags,
  );

  const model = flags.model ?? defaults.model ?? env.EVAL_MODEL_OVERRIDE ?? undefined;
  const provider = flags.provider ?? defaults.provider ?? env.EVAL_PROVIDER ?? undefined;
  const useApi =
    flags.api ??
    defaults.api ??
    ((env.USE_API ?? "").toLowerCase() === "true");
  const trials =
    flags.trials ??
    defaults.trials ??
    parseIntEnv(env.EVAL_TRIAL_COUNT) ??
    3;
  const concurrency =
    flags.concurrency ??
    defaults.concurrency ??
    parseIntEnv(env.EVAL_MAX_CONCURRENCY) ??
    3;

  const datasetFilter = shorthandDatasetFilter ?? env.EVAL_DATASET ?? undefined;

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
    datasetFilter,
    envOverrides,
    dryRun: flags.dryRun ?? false,
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

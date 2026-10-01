/**
 * Config command — read/write `evals.config.json` (+ `evals.config.local.json`).
 *
 * Two files live in the same directory as the running module:
 *   - `evals.config.json`       tracked, team defaults, schema `version: 2`
 *   - `evals.config.local.json` gitignored, personal overrides + first-run state
 *
 * `readConfig` deep-merges local over tracked. Every write goes to the local
 * file unless `scope: "shared"` is passed: the local file only ever holds the
 * keys that differ from the tracked file, so `git diff` stays quiet and a
 * `config set` never rewrites team defaults by accident.
 *
 * Precedence: a flag always wins. `defaults.*` then read local → tracked
 * before the ambient EVAL_* env vars (see parse.ts); every other section
 * yields to its env twin: flag → env → local → tracked → code default.
 *
 * Per-mode storage (source vs. dist) is intentional:
 *   - Source mode (tsx packages/evals/cli.ts): packages/evals/
 *   - Built mode (dist/cli/cli.js):            packages/evals/dist/cli/
 * `scripts/build-cli.ts` seeds the tracked file into dist verbatim and never
 * touches the dist-local file.
 *
 * v1 files (no `version`) load unchanged: the new sections are simply empty.
 *
 * The `entryDir` is computed via `getCurrentDirPath()` at the top of
 * `cli.ts` (the entry) and passed down so this module stays side-effect
 * free.
 */

import fs from "node:fs";
import path from "node:path";
import { bold, dim, cyan, gray, green, red, yellow } from "../format.js";
import { getPackageRootDir } from "../../runtimePaths.js";

export const CONFIG_SCHEMA_VERSION = 2;

type Defaults = {
  env?: string | null;
  trials?: number | null;
  concurrency?: number | null;
  model?: string | null;
  api?: boolean | null;
  verbose?: boolean | null;
  /** Default `--harness` for bench runs. */
  harness?: string | null;
  /** Default `--success` mode. */
  successMode?: string | null;
};

/** Per-suite defaults; `limit` backs `EVAL_<SUITE>_LIMIT` when `--limit` is absent. */
export type BenchmarkConfigSection = {
  limit?: number | null;
};

/**
 * Per-harness defaults. `models` backs `EVAL_<HARNESS>_MODELS`, `tool` is the
 * `--tool` default for that harness, `nodeOptions` is advisory (doctor heap
 * check) because the CLI cannot re-exec itself inside the REPL.
 */
export type HarnessConfigSection = {
  models?: string[] | null;
  tool?: string | null;
  nodeOptions?: string | null;
};

/** Per-provider semaphore width under the global cap (framework/providerConcurrency.ts). */
export type ProviderConfigSection = {
  concurrency?: number | null;
};

/** Verifier defaults; env always wins (EVAL_VERIFIER_MODEL, EVAL_MAX_UNVERIFIABLE_CRITERIA). */
export type VerifierConfigSection = {
  model?: string | null;
  maxUnverifiableCriteria?: number | null;
};

/** Campaign tag stamped on experiment metadata. */
export type CampaignConfigSection = {
  tag?: string | null;
};

export type CoreConfigSection = {
  tool?: string;
  startup?: string;
};

/**
 * First-run / welcome metadata. Persisted inside `evals.config.json` so it
 * follows the same per-mode (source vs. dist) storage as `defaults`/`core`.
 * Owned by tui/welcomeState.ts; the type lives here because it round-trips
 * through readConfig/writeConfig.
 */
export type WelcomeMeta = {
  /** ISO 8601 timestamp when the first-run welcome was completed. */
  firstRunCompletedAt?: string;
  /** Schema version for the welcome marker (currently 1). */
  version?: number;
};

/**
 * Trace sink configuration. Every key maps 1:1 to an env var, and the env var
 * always wins — this section is a persisted default for users who don't want
 * to export vars per shell. Owned by tui/commands/tracing.ts.
 *
 *   transport         → EVAL_TRACE_TRANSPORT   ("native" | "otel")
 *   braintrustProject → BRAINTRUST_PROJECT_NAME (both transports)
 *   langsmithProject  → LANGSMITH_PROJECT       (otel transport only)
 */
export type TracingConfigSection = {
  transport?: TraceTransport;
  braintrustProject?: string;
  langsmithProject?: string;
};

export type TraceTransport = "native" | "otel";

export const TRACING_ENV_VARS: Record<keyof TracingConfigSection, string> = {
  transport: "EVAL_TRACE_TRANSPORT",
  braintrustProject: "BRAINTRUST_PROJECT_NAME",
  langsmithProject: "LANGSMITH_PROJECT",
};

export type ConfigFile = {
  version?: number;
  defaults: Defaults;
  benchmarks?: Record<string, BenchmarkConfigSection>;
  harnesses?: Record<string, HarnessConfigSection>;
  providers?: Record<string, ProviderConfigSection>;
  verifier?: VerifierConfigSection;
  campaign?: CampaignConfigSection;
  core?: CoreConfigSection;
  tracing?: TracingConfigSection;
  _meta?: WelcomeMeta;
};

export type ConfigScope = "local" | "shared";

const VALID_KEYS: Array<keyof Defaults> = [
  "env",
  "trials",
  "concurrency",
  "model",
  "api",
  "verbose",
  "harness",
  "successMode",
];

/** Keys `config set` used to accept and now rejects with a pointer. */
const DEPRECATED_KEYS: Record<string, string> = {
  provider:
    'provider is derived from the model id ("openai/gpt-5.4-mini" → openai) and was never read',
};

const DEFAULT_VALUES: Defaults = {
  env: "local",
  trials: 3,
  concurrency: 3,
  model: null,
  api: false,
  verbose: false,
  harness: null,
  successMode: null,
};

export const CONFIG_FILE_NAME = "evals.config.json";
export const LOCAL_CONFIG_FILE_NAME = "evals.config.local.json";

/** Tracked team defaults. */
export function resolveConfigPath(entryDir: string): string {
  return path.join(entryDir, CONFIG_FILE_NAME);
}

/** Gitignored personal overrides + first-run state, beside the tracked file. */
export function resolveLocalConfigPath(entryDir: string): string {
  return path.join(entryDir, LOCAL_CONFIG_FILE_NAME);
}

type JsonObject = Record<string, unknown>;

function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Objects merge recursively; arrays and primitives replace. A `null` in the
 * overlay *removes* the key — that is how the local file expresses "unset
 * what the tracked file says" (`config reset`, `config set model null`).
 */
export function mergeConfig<T extends JsonObject>(base: T, overlay: JsonObject | undefined): T {
  if (!overlay) return base;
  const out: JsonObject = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    if (value === undefined) continue;
    if (value === null) {
      delete out[key];
      continue;
    }
    const existing = out[key];
    out[key] =
      isPlainObject(existing) && isPlainObject(value) ? mergeConfig(existing, value) : value;
  }
  return out as T;
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * The overlay that turns `base` into `merged`: keys whose value differs, plus
 * `null` for keys `base` has and `merged` dropped. `mergeConfig(base, diff)`
 * reproduces `merged` (with `null`s in `merged` read as "absent").
 */
export function diffConfig(merged: JsonObject, base: JsonObject): JsonObject {
  const out: JsonObject = {};
  for (const [key, value] of Object.entries(merged)) {
    const baseValue = base[key];
    const absent = value === undefined || value === null;
    if (absent) {
      if (baseValue !== undefined && baseValue !== null) out[key] = null;
      continue;
    }
    if (baseValue === undefined || baseValue === null) {
      out[key] = value;
      continue;
    }
    if (isPlainObject(value) && isPlainObject(baseValue)) {
      const nested = diffConfig(value, baseValue);
      if (Object.keys(nested).length > 0) out[key] = nested;
      continue;
    }
    if (!deepEqual(value, baseValue)) out[key] = value;
  }
  for (const key of Object.keys(base)) {
    if (!(key in merged) && base[key] !== undefined && base[key] !== null) out[key] = null;
  }
  return out;
}

/** Shape a raw parsed object into a ConfigFile; unknown top-level keys are dropped. */
function normalizeConfig(raw: JsonObject): ConfigFile {
  const defaults = isPlainObject(raw.defaults) ? { ...raw.defaults } : {};
  // `defaults.provider` was written by v1 and read by nothing.
  delete defaults.provider;
  return {
    ...(typeof raw.version === "number" && { version: raw.version }),
    defaults: defaults as Defaults,
    ...(isPlainObject(raw.benchmarks) && {
      benchmarks: raw.benchmarks as Record<string, BenchmarkConfigSection>,
    }),
    ...(isPlainObject(raw.harnesses) && {
      harnesses: raw.harnesses as Record<string, HarnessConfigSection>,
    }),
    ...(isPlainObject(raw.providers) && {
      providers: raw.providers as Record<string, ProviderConfigSection>,
    }),
    ...(isPlainObject(raw.verifier) && { verifier: raw.verifier as VerifierConfigSection }),
    ...(isPlainObject(raw.campaign) && { campaign: raw.campaign as CampaignConfigSection }),
    ...(isPlainObject(raw.core) && { core: raw.core as CoreConfigSection }),
    ...(isPlainObject(raw.tracing) && { tracing: raw.tracing as TracingConfigSection }),
    ...(isPlainObject(raw._meta) && { _meta: raw._meta as WelcomeMeta }),
  };
}

function readJsonFile(
  filePath: string,
  { optional }: { optional: boolean },
): JsonObject | undefined {
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    if (!isPlainObject(raw)) throw new SyntaxError("top-level value must be an object");
    return raw;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      if (optional) return undefined;
      throw new Error(`Missing config file: ${filePath}`, { cause: error });
    }
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid JSON in ${filePath}: ${error.message}`, { cause: error });
    }
    throw error;
  }
}

/** The tracked file only, normalized. v1 (no `version`) reads as v2 with empty new sections. */
export function readTrackedConfig(entryDir: string): ConfigFile {
  const raw = readJsonFile(resolveConfigPath(entryDir), { optional: false })!;
  const config = normalizeConfig(raw);
  return { ...config, benchmarks: config.benchmarks ?? {} };
}

const CONFIG_SECTIONS = [
  "version",
  "defaults",
  "benchmarks",
  "harnesses",
  "providers",
  "verifier",
  "campaign",
  "core",
  "tracing",
  "_meta",
] as const;

/**
 * The local overrides file only; `{}` when absent. Kept sparse and raw
 * (nulls included — they are removal markers for mergeConfig), limited to
 * known sections.
 */
export function readLocalConfig(entryDir: string): Partial<ConfigFile> {
  const raw = readJsonFile(resolveLocalConfigPath(entryDir), { optional: true });
  if (!raw) return {};
  const local: JsonObject = {};
  for (const section of CONFIG_SECTIONS) {
    if (section in raw) local[section] = raw[section];
  }
  if (isPlainObject(local.defaults)) {
    const defaults = { ...local.defaults };
    delete defaults.provider;
    local.defaults = defaults;
  }
  return local as Partial<ConfigFile>;
}

/** Effective config: local overrides deep-merged over the tracked file. */
export function readConfig(entryDir: string): ConfigFile {
  return mergeConfig(readTrackedConfig(entryDir), readLocalConfig(entryDir) as JsonObject);
}

function writeJsonFile(filePath: string, value: JsonObject): void {
  // Prune undefined top-level fields so optional sections don't round-trip as `null`.
  const out: JsonObject = {};
  for (const [k, v] of Object.entries(value)) {
    if (v !== undefined) out[k] = v;
  }
  fs.writeFileSync(filePath, JSON.stringify(out, null, 2) + "\n");
}

/**
 * Persist an effective (merged) config to the local file. Only the keys that
 * differ from the tracked file are stored, so the tracked file is never
 * touched and `git diff` stays quiet.
 */
export function writeConfig(entryDir: string, config: ConfigFile): void {
  const tracked = readTrackedConfig(entryDir) as JsonObject;
  writeJsonFile(resolveLocalConfigPath(entryDir), diffConfig(config as JsonObject, tracked));
}

/**
 * Where a `--shared` write lands. The team file is the one in the source tree
 * (packages/evals/evals.config.json); in dist mode the seeded copy under
 * dist/cli is rewritten too so the change applies before the next build.
 */
function sharedConfigPaths(entryDir: string): string[] {
  const running = resolveConfigPath(entryDir);
  const isDist = /[/\\]dist[/\\]cli[/\\]?$/.test(entryDir);
  if (!isDist) return [running];
  return [path.join(getPackageRootDir(), CONFIG_FILE_NAME), running];
}

/**
 * Apply one change to the config. `mutate` edits the config in place.
 *
 *   local (default)  mutate the effective config; store the difference in
 *                    evals.config.local.json.
 *   shared           mutate the tracked file alone, so personal overrides in
 *                    the local file can never leak into the team defaults;
 *                    then drop local overrides the new tracked value makes
 *                    redundant.
 */
export function updateConfig(
  entryDir: string,
  mutate: (config: ConfigFile) => void,
  options: { scope?: ConfigScope } = {},
): void {
  if ((options.scope ?? "local") === "local") {
    const config = readConfig(entryDir);
    mutate(config);
    writeConfig(entryDir, config);
    return;
  }
  const tracked = structuredClone(readTrackedConfig(entryDir));
  mutate(tracked);
  const { _meta, ...shared } = tracked;
  const nextTracked: JsonObject = { ...shared, version: CONFIG_SCHEMA_VERSION };
  for (const filePath of sharedConfigPaths(entryDir)) writeJsonFile(filePath, nextTracked);
  const local = readLocalConfig(entryDir) as JsonObject;
  const remaining = pruneOverrides(local, nextTracked);
  // A v1 tracked file may still carry the first-run marker; it is personal.
  const meta = (local._meta as WelcomeMeta | undefined) ?? _meta;
  if (meta) remaining._meta = meta;
  writeJsonFile(resolveLocalConfigPath(entryDir), remaining);
}

/** Drop local overrides (and removal markers) that no longer change anything against `base`. */
function pruneOverrides(local: JsonObject, base: JsonObject): JsonObject {
  const out: JsonObject = {};
  for (const [key, value] of Object.entries(local)) {
    const baseValue = base[key];
    if (value === null) {
      if (baseValue !== undefined && baseValue !== null) out[key] = null;
      continue;
    }
    if (isPlainObject(value) && isPlainObject(baseValue)) {
      const nested = pruneOverrides(value, baseValue);
      if (Object.keys(nested).length > 0) out[key] = nested;
      continue;
    }
    if (!deepEqual(value, baseValue)) out[key] = value;
  }
  return out;
}

/** Top-level sections that carry at least one local override. */
export function localOverrideSections(entryDir: string): string[] {
  return Object.keys(readLocalConfig(entryDir)).filter((key) => key !== "_meta");
}

export function printConfig(entryDir: string): void {
  const config = readConfig(entryDir);
  const local = readLocalConfig(entryDir);
  const defaults = config.defaults;
  const localDefaults = local.defaults ?? {};
  const mark = (key: keyof Defaults) => (key in localDefaults ? dim(" (local)") : "");

  console.log(`\n  ${bold("Configuration:")}\n`);
  console.log(`    ${cyan("env")}          ${defaults.env ?? "local"}${mark("env")}`);
  console.log(`    ${cyan("trials")}       ${defaults.trials ?? 3}${mark("trials")}`);
  console.log(`    ${cyan("concurrency")}  ${defaults.concurrency ?? 3}${mark("concurrency")}`);
  console.log(`    ${cyan("api")}          ${defaults.api ?? false}${mark("api")}`);
  console.log(`    ${cyan("verbose")}      ${defaults.verbose ?? false}${mark("verbose")}`);
  console.log(
    `    ${cyan("model")}        ${defaults.model ?? gray("(default per category)")}${mark("model")}`,
  );
  console.log(
    `    ${cyan("harness")}      ${defaults.harness ?? gray("(stagehand)")}${mark("harness")}`,
  );
  console.log(
    `    ${cyan("successMode")}  ${defaults.successMode ?? gray("(outcome)")}${mark("successMode")}`,
  );

  const sections: Array<[string, unknown]> = [
    ["harnesses", config.harnesses],
    ["providers", config.providers],
    ["verifier", config.verifier],
    ["campaign", config.campaign],
  ];
  for (const [name, section] of sections) {
    if (!section || Object.keys(section as JsonObject).length === 0) continue;
    const localMark = name in local ? dim(" (local overrides)") : "";
    console.log(`\n    ${cyan(name)}${localMark}`);
    for (const [key, value] of Object.entries(section as JsonObject)) {
      console.log(`      ${key}  ${gray(JSON.stringify(value))}`);
    }
  }

  const env = process.env;
  const overrides: string[] = [];
  if (env.EVAL_ENV) overrides.push(`EVAL_ENV=${env.EVAL_ENV}`);
  if (env.EVAL_MODELS) overrides.push(`EVAL_MODELS=${env.EVAL_MODELS}`);
  if (env.USE_API) overrides.push(`USE_API=${env.USE_API}`);
  if (env.STAGEHAND_BROWSER_TARGET)
    overrides.push(`STAGEHAND_BROWSER_TARGET=${env.STAGEHAND_BROWSER_TARGET}`);
  for (const name of Object.values(TRACING_ENV_VARS)) {
    if (env[name]) overrides.push(`${name}=${env[name]}`);
  }

  if (overrides.length > 0) {
    console.log(`\n    ${dim("Env overrides:")}`);
    for (const o of overrides) {
      console.log(`      ${gray(o)}`);
    }
  }

  console.log(
    `\n    ${dim("Precedence: flag → evals.config.local.json → evals.config.json → env → default (defaults); env twins win for the other sections")}`,
  );
  console.log(
    `    ${dim(`Files: ${resolveConfigPath(entryDir)}${fs.existsSync(resolveLocalConfigPath(entryDir)) ? ` + ${LOCAL_CONFIG_FILE_NAME}` : ""}`)}`,
  );
  console.log("");
}

/** Strip a trailing `--shared` from a `config … set` argv. */
export function takeScopeFlag(args: string[]): { args: string[]; scope: ConfigScope } {
  const index = args.indexOf("--shared");
  if (index === -1) return { args, scope: "local" };
  return { args: [...args.slice(0, index), ...args.slice(index + 1)], scope: "shared" };
}

export async function handleConfig(rawArgs: string[], entryDir: string): Promise<void> {
  const { args, scope } = takeScopeFlag(rawArgs);
  if (args.length === 0) {
    printConfig(entryDir);
    return;
  }

  const sub = args[0];

  if (sub === "harnesses" || sub === "providers" || sub === "verifier" || sub === "campaign") {
    const { handleConfigSection } = await import("./configSections.js");
    handleConfigSection(sub, args.slice(1), entryDir, scope);
    return;
  }

  if (sub === "help" || sub === "-h" || sub === "--help") {
    const { printConfigHelp } = await import("./help.js");
    await printConfigHelp();
    return;
  }

  if (sub === "core") {
    const { handleCore } = await import("./core.js");
    await handleCore(args.slice(1), entryDir);
    return;
  }

  if (sub === "tracing") {
    const { handleTracing } = await import("./tracing.js");
    await handleTracing(args.slice(1), entryDir);
    return;
  }

  // Per-sub help. We only intercept when the help token is at args[1] —
  // immediately after the verb — so leaf values at args[2+] (e.g.
  // `set model --help`) are never swallowed as help and reach `parseValue`
  // unchanged. Core has its own help and is handled above.
  if (args[1] === "--help" || args[1] === "-h" || args[1] === "help") {
    const { printConfigHelp } = await import("./help.js");
    await printConfigHelp();
    return;
  }

  if (sub === "path") {
    console.log(
      args[1] === "local" ? resolveLocalConfigPath(entryDir) : resolveConfigPath(entryDir),
    );
    return;
  }

  if (sub === "set") {
    if (args.length < 3) {
      console.error(red("  Usage: config set <key> <value>"));
      process.exitCode = 1;
      return;
    }
    const key = args[1] as keyof Defaults;
    const rawValue = args.slice(2).join(" ");
    if (key in DEPRECATED_KEYS) {
      console.log(
        yellow(`  ⚠ config key "${key}" is deprecated: ${DEPRECATED_KEYS[key]}. Ignored.`),
      );
      return;
    }
    if (!VALID_KEYS.includes(key)) {
      console.error(red(`  Unknown config key "${key}"`));
      console.log(dim(`  Valid keys: ${VALID_KEYS.join(", ")}`));
      process.exitCode = 1;
      return;
    }
    const parsed = parseValue(key, rawValue);
    if (parsed === parseError) {
      process.exitCode = 1;
      return;
    }
    if (key === "harness" && typeof parsed === "string") {
      const { isBenchHarness, listBenchHarnesses } =
        await import("../../framework/benchHarness.js");
      if (!isBenchHarness(parsed)) {
        console.error(
          red(`  Unknown harness "${parsed}". Registered: ${listBenchHarnesses().join(", ")}`),
        );
        process.exitCode = 1;
        return;
      }
    }

    updateConfig(
      entryDir,
      (config) => {
        config.defaults = { ...config.defaults, [key]: parsed };
      },
      { scope },
    );
    console.log(green(`  ✓ Set ${key} to ${String(parsed)}${scopeSuffix(scope)}`));
    return;
  }

  if (sub === "reset") {
    if (args.length === 1) {
      updateConfig(
        entryDir,
        (config) => {
          config.defaults = { ...DEFAULT_VALUES };
        },
        { scope },
      );
      console.log(green(`  ✓ Reset all defaults${scopeSuffix(scope)}`));
      return;
    }
    const key = args[1] as keyof Defaults;
    if (!VALID_KEYS.includes(key)) {
      console.error(red(`  Unknown config key "${key}"`));
      process.exitCode = 1;
      return;
    }
    updateConfig(
      entryDir,
      (config) => {
        config.defaults = { ...config.defaults, [key]: DEFAULT_VALUES[key] };
      },
      { scope },
    );
    console.log(green(`  ✓ Reset ${key} to default${scopeSuffix(scope)}`));
    return;
  }

  console.error(red(`  Unknown config subcommand "${sub}"`));
  console.log(
    dim(
      "  Usage: config [set <key> <value> [--shared] | reset [key] | path | core | tracing | harnesses | providers | verifier | campaign]",
    ),
  );
  process.exitCode = 1;
}

export function scopeSuffix(scope: ConfigScope): string {
  return scope === "shared" ? dim(` (${CONFIG_FILE_NAME})`) : dim(` (${LOCAL_CONFIG_FILE_NAME})`);
}

const parseError = Symbol("parse-error");

function parseValue(
  key: keyof Defaults,
  raw: string,
): string | number | boolean | null | typeof parseError {
  if (raw === "null" || raw === "none") return null;
  if (key === "env") {
    const normalized = raw.toLowerCase();
    if (normalized !== "local" && normalized !== "browserbase") {
      console.error(red("  env must be local or browserbase"));
      return parseError;
    }
    return normalized;
  }
  if (key === "trials" || key === "concurrency") {
    if (!/^[0-9]+$/.test(raw)) {
      console.error(red(`  ${key} must be a positive integer`));
      return parseError;
    }
    const n = Number(raw);
    if (!Number.isSafeInteger(n) || n <= 0) {
      console.error(red(`  ${key} must be a positive integer`));
      return parseError;
    }
    return n;
  }
  if (key === "api" || key === "verbose") {
    if (raw !== "true" && raw !== "false") {
      console.error(red(`  ${key} must be true or false`));
      return parseError;
    }
    return raw === "true";
  }
  if (key === "successMode") {
    if (!["outcome", "process", "both"].includes(raw)) {
      console.error(red("  successMode must be outcome, process or both"));
      return parseError;
    }
    return raw;
  }
  return raw;
}

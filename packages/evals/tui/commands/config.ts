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
  harness?: string | null;
  successMode?: string | null;
};

export type BenchmarkConfigSection = {
  limit?: number | null;
};

export type HarnessConfigSection = {
  models?: string[] | null;
  tool?: string | null;
  nodeOptions?: string | null;
};

export type ProviderConfigSection = {
  concurrency?: number | null;
};

export type VerifierConfigSection = {
  model?: string | null;
  maxUnverifiableCriteria?: number | null;
};

export type CampaignConfigSection = {
  tag?: string | null;
};

export type CoreConfigSection = {
  tool?: string;
  startup?: string;
};

export type WelcomeMeta = {
  firstRunCompletedAt?: string;
  version?: number;
};

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

export function resolveConfigPath(entryDir: string): string {
  return path.join(entryDir, CONFIG_FILE_NAME);
}

export function resolveLocalConfigPath(entryDir: string): string {
  return path.join(entryDir, LOCAL_CONFIG_FILE_NAME);
}

type JsonObject = Record<string, unknown>;

function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

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

function normalizeConfig(raw: JsonObject): ConfigFile {
  const defaults = isPlainObject(raw.defaults) ? { ...raw.defaults } : {};
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

export function readLocalConfig(entryDir: string): Partial<ConfigFile> {
  const raw = readJsonFile(resolveLocalConfigPath(entryDir), { optional: true });
  if (!raw) return {};
  const local: JsonObject = {};
  for (const section of CONFIG_SECTIONS) {
    if (section in raw) local[section] = raw[section];
  }
  if ("defaults" in local && !isPlainObject(local.defaults)) {
    throw new Error(`Invalid ${resolveLocalConfigPath(entryDir)}: "defaults" must be an object.`);
  }
  if (isPlainObject(local.defaults)) {
    const defaults = { ...local.defaults };
    delete defaults.provider;
    local.defaults = defaults;
  }
  return local as Partial<ConfigFile>;
}

export function readConfig(entryDir: string): ConfigFile {
  return mergeConfig(readTrackedConfig(entryDir), readLocalConfig(entryDir) as JsonObject);
}

function writeJsonFile(filePath: string, value: JsonObject): void {
  const out: JsonObject = {};
  for (const [k, v] of Object.entries(value)) {
    if (v !== undefined) out[k] = v;
  }
  fs.writeFileSync(filePath, JSON.stringify(out, null, 2) + "\n");
}

export function writeConfig(entryDir: string, config: ConfigFile): void {
  const tracked = readTrackedConfig(entryDir) as JsonObject;
  writeJsonFile(resolveLocalConfigPath(entryDir), diffConfig(config as JsonObject, tracked));
}

function sharedConfigPaths(entryDir: string): string[] {
  const running = resolveConfigPath(entryDir);
  const isDist = /[/\\]dist[/\\]cli[/\\]?$/.test(entryDir);
  if (!isDist) return [running];
  return [path.join(getPackageRootDir(), CONFIG_FILE_NAME), running];
}

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
  const meta = (local._meta as WelcomeMeta | undefined) ?? _meta;
  if (meta) remaining._meta = meta;
  writeJsonFile(resolveLocalConfigPath(entryDir), remaining);
}

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
    `\n    ${dim("Precedence: flag → evals.config.local.json → evals.config.json → env for most defaults; env wins for successMode, the browser target and the other sections")}`,
  );
  console.log(
    `    ${dim(`Files: ${resolveConfigPath(entryDir)}${fs.existsSync(resolveLocalConfigPath(entryDir)) ? ` + ${LOCAL_CONFIG_FILE_NAME}` : ""}`)}`,
  );
  console.log("");
}

export function rejectSharedScope(section: "core" | "tracing"): void {
  console.error(
    red(
      `  --shared is not supported for config ${section}; edit ${CONFIG_FILE_NAME} directly to change the team default.`,
    ),
  );
  process.exitCode = 1;
}

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

  if ((sub === "core" || sub === "tracing") && scope === "shared") {
    rejectSharedScope(sub);
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

/**
 * `evals doctor` — Harnesses / Verifier / Browserbase / Environment probes.
 *
 * Built from the harness registry: every executable harness gets a row of
 * cheap, read-only probes (binary or runtime resolvable, provider key
 * present, extra per-harness requirement). Network probes run only with
 * `--probe` and validate the key against the provider's models endpoint so a
 * dead key is caught here instead of as a silent `sdk_error` in a run.
 *
 * Every failed probe carries the exact command that fixes it. Verdict rule:
 * only requested harnesses (`--harness` or `defaults.harness`) — and, when
 * one was requested, the verifier and Browserbase rows — can change the
 * verdict; the rest of the matrix is informational (see
 * harnessMatrixReasons).
 *
 * fx and cursor are not probed yet: their auth state lives inside the CLI and
 * the status subcommands have not been confirmed by the owners.
 */

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { getBenchHarness, listExecutableBenchHarnesses } from "../../framework/benchHarness.js";
import { ProviderConcurrency, providerFromModel } from "../../framework/providerConcurrency.js";
import { resolveVerifierModel } from "../../framework/verifierModel.js";
import { getPackageRootDir } from "../../runtimePaths.js";
import { getEvalsEnvReport, type EvalsEnvReport } from "../../evalsEnv.js";
import type { ConfigFile } from "./config.js";

export type ProbeStatus = "ok" | "warn" | "fail" | "skipped" | "unknown";

export interface Probe {
  status: ProbeStatus;
  /** Short cell text, e.g. `sdk`, `ANTHROPIC_API_KEY`, `401`, `heap 4096 MB < 12288`. */
  label: string;
  /** Longer explanation printed under the row when the probe is not ok. */
  detail?: string;
  /** Exact remediation command. */
  fix?: string;
}

export interface HarnessProbeRow {
  harness: string;
  /** Requested via --harness or the config default: failures fail the verdict. */
  required: boolean;
  binary: Probe;
  key: Probe;
  probe: Probe;
  extra: Probe;
  status: ProbeStatus;
}

export interface NamedProbeRow {
  name: "verifier" | "browserbase";
  probes: Probe[];
  status: ProbeStatus;
  /** Effective judge (verifier row only). */
  detail?: string;
}

export interface EnvironmentReport {
  files: Array<{ kind: "package" | "cwd"; path: string; loaded: boolean; applied: number }>;
  shadowed: Array<{ name: string; file: string; by: string }>;
  ci: { set: boolean; fix?: string };
  status: ProbeStatus;
}

export interface HarnessMatrix {
  harnesses: HarnessProbeRow[];
  verifier: NamedProbeRow;
  browserbase: NamedProbeRow;
  environment: EnvironmentReport;
  /** Harnesses excluded from this pass. */
  skipped: string[];
}

/** Harnesses whose auth lives inside a third-party CLI; not probed yet. */
export const UNPROBED_HARNESSES: ReadonlySet<string> = new Set(["fx", "cursor"]);

/** In-process harnesses that need the heap flag past this concurrency. */
const HEAP_HARNESSES: ReadonlySet<string> = new Set(["mastra", "pi"]);
const HEAP_MIN_MB = 12288;
const HEAP_CONCURRENCY_THRESHOLD = 5;

const PROVIDER_KEY_ENV: Record<string, string[]> = {
  openai: ["OPENAI_API_KEY"],
  anthropic: ["ANTHROPIC_API_KEY"],
  google: ["GOOGLE_GENERATIVE_AI_API_KEY", "GEMINI_API_KEY"],
};

export interface HarnessProbeOptions {
  config?: ConfigFile;
  env?: NodeJS.ProcessEnv;
  /** `--harness a,b` narrows the rows; `all`/undefined probes every executable harness. */
  requested?: string[];
  /** Run network probes. */
  probe?: boolean;
  fetchImpl?: typeof fetch;
  /** Package resolvability check; defaults to createRequire from the evals package. */
  resolvePackage?: (specifier: string) => boolean;
  /** Executable lookup on PATH; defaults to a PATH scan. */
  which?: (binary: string) => string | undefined;
  execArgv?: string[];
  envReport?: EvalsEnvReport;
  /** Effective global concurrency for the heap check. */
  concurrency?: number;
}

// ---------------------------------------------------------------------------
// Primitive checks
// ---------------------------------------------------------------------------

/**
 * Is `specifier` installed for the evals package or any integration package?
 * `require.resolve` alone rejects ESM-only packages (no CJS entry in
 * `exports`), so fall back to looking for the package.json in each
 * package's node_modules — the same tree the dynamic `import()` walks.
 */
function defaultResolvePackage(specifier: string): boolean {
  const packageRoot = getPackageRootDir();
  const packagesDir = path.dirname(packageRoot);
  const roots = [packageRoot, path.dirname(packagesDir)];
  try {
    const integrations = path.join(packagesDir, "integrations");
    for (const entry of fs.readdirSync(integrations, { withFileTypes: true })) {
      if (entry.isDirectory()) roots.push(path.join(integrations, entry.name));
    }
  } catch {
    // no integrations dir in this checkout
  }
  for (const root of roots) {
    try {
      createRequire(path.join(root, "package.json")).resolve(specifier);
      return true;
    } catch {
      // ESM-only or absent: check the tree directly
    }
    if (fs.existsSync(path.join(root, "node_modules", specifier, "package.json"))) return true;
  }
  return false;
}

function defaultWhich(binary: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  for (const dir of (env.PATH ?? "").split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, binary);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // keep looking
    }
  }
  return undefined;
}

function isExecutable(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function isWritableDir(dir: string): boolean {
  try {
    fs.accessSync(dir, fs.constants.W_OK);
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

/** `--max-old-space-size=N` from NODE_OPTIONS or execArgv, in MB. */
export function readMaxOldSpaceMb(env: NodeJS.ProcessEnv, execArgv: string[]): number | undefined {
  const sources = [...(env.NODE_OPTIONS ?? "").split(/\s+/), ...execArgv];
  let found: number | undefined;
  for (const token of sources) {
    const match = /^--max-old-space-size=(\d+)$/.exec(token);
    if (match) found = Number(match[1]);
  }
  return found;
}

function keyProbe(
  provider: string | undefined,
  env: NodeJS.ProcessEnv,
): Probe & { value?: string } {
  if (!provider) return { status: "unknown", label: "no provider" };
  const names = PROVIDER_KEY_ENV[provider];
  if (!names) {
    return {
      status: "unknown",
      label: `${provider} key`,
      detail: `No known key variable for provider "${provider}".`,
    };
  }
  for (const name of names) {
    const value = env[name]?.trim();
    if (value) return { status: "ok", label: name, value };
  }
  return {
    status: "fail",
    label: names[0],
    detail: `${names[0]} is not set; ${provider} runs would end in sdk_error with no output.`,
    fix: `add ${names[0]} to ${path.join(getPackageRootDir(), ".env")} or export it in your shell`,
  };
}

/** Line number of `NAME=` in an env file, for the remediation message. Never reads values out. */
function envKeyLine(filePath: string, name: string): number | undefined {
  try {
    const lines = fs.readFileSync(filePath, "utf-8").split("\n");
    const index = lines.findIndex((line) => line.trim().startsWith(`${name}=`));
    return index === -1 ? undefined : index + 1;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Network probes (only with --probe)
// ---------------------------------------------------------------------------

type ProviderProbeResult = { ok: boolean; status?: number; error?: string };

async function probeProvider(
  provider: string,
  apiKey: string,
  fetchImpl: typeof fetch,
): Promise<ProviderProbeResult> {
  const request: { url: string; headers: Record<string, string> } | undefined =
    provider === "openai"
      ? {
          url: "https://api.openai.com/v1/models?limit=1",
          headers: { Authorization: `Bearer ${apiKey}` },
        }
      : provider === "anthropic"
        ? {
            url: "https://api.anthropic.com/v1/models?limit=1",
            headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
          }
        : provider === "google"
          ? {
              url: `https://generativelanguage.googleapis.com/v1beta/models?pageSize=1&key=${encodeURIComponent(apiKey)}`,
              headers: {},
            }
          : undefined;
  if (!request) return { ok: false, error: `no probe for provider "${provider}"` };
  try {
    const res = await fetchImpl(request.url, { headers: request.headers });
    return { ok: res.ok, status: res.status };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

/** Judge model exists for its provider (Google: GET models/<id>; others: provider probe). */
async function probeJudge(
  modelName: string,
  apiKey: string,
  fetchImpl: typeof fetch,
): Promise<ProviderProbeResult & { retired?: boolean }> {
  const provider = providerFromModel(modelName);
  if (provider !== "google") {
    return provider
      ? probeProvider(provider, apiKey, fetchImpl)
      : { ok: false, error: "no provider" };
  }
  const id = modelName.slice("google/".length);
  try {
    const res = await fetchImpl(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(id)}?key=${encodeURIComponent(apiKey)}`,
    );
    if (res.status === 404) return { ok: false, status: 404, retired: true };
    return { ok: res.ok, status: res.status };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

function probeFromResult(
  result: ProviderProbeResult,
  keyName: string,
  keyFile: string | undefined,
): Probe {
  if (result.ok) return { status: "ok", label: String(result.status ?? 200) };
  if (result.status === 401 || result.status === 403) {
    const line = keyFile ? envKeyLine(keyFile, keyName) : undefined;
    const where = keyFile
      ? `${keyFile}${line ? ` (line ${line} is what the runner loads)` : ""}`
      : "your shell";
    return {
      status: "fail",
      label: String(result.status),
      detail: `key rejected by the provider; runs would end in sdk_error with no output.`,
      fix: `replace ${keyName} in ${where}`,
    };
  }
  if (result.status === 429) {
    return {
      status: "warn",
      label: "429",
      detail: "provider is rate limiting this key right now.",
    };
  }
  return {
    status: "fail",
    label: result.status ? String(result.status) : "error",
    detail: result.error ?? `HTTP ${result.status}`,
  };
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

function worst(...statuses: ProbeStatus[]): ProbeStatus {
  const order: ProbeStatus[] = ["fail", "warn", "unknown", "ok", "skipped"];
  for (const status of order) if (statuses.includes(status)) return status;
  return "skipped";
}

function skipped(label = "—"): Probe {
  return { status: "skipped", label };
}

/**
 * How many sessions of a harness actually run at once: the global cap, cut
 * down by the provider's width (EVAL_PROVIDER_CONCURRENCY over config).
 */
function effectiveWidth(
  globalConcurrency: number,
  provider: string | undefined,
  config: ConfigFile | undefined,
  env: NodeJS.ProcessEnv,
): number {
  if (!provider) return globalConcurrency;
  const configWidths = Object.fromEntries(
    Object.entries(config?.providers ?? {}).flatMap(([name, section]) =>
      typeof section?.concurrency === "number" ? [[name, section.concurrency]] : [],
    ),
  );
  try {
    return ProviderConcurrency.fromEnv(globalConcurrency, { env, configWidths }).configuredWidth(
      provider,
    );
  } catch {
    // A malformed EVAL_PROVIDER_CONCURRENCY fails the run at plan time; here
    // fall back to the global cap rather than masking the rest of the report.
    return globalConcurrency;
  }
}

function heapProbe(
  harness: string,
  env: NodeJS.ProcessEnv,
  execArgv: string[],
  concurrency: number,
  nodeOptions: string | null | undefined,
): Probe {
  if (!HEAP_HARNESSES.has(harness)) return skipped();
  if (concurrency < HEAP_CONCURRENCY_THRESHOLD) {
    return { status: "ok", label: `heap n/a at concurrency ${concurrency}` };
  }
  const configured = nodeOptions ? readMaxOldSpaceMb({ NODE_OPTIONS: nodeOptions }, []) : undefined;
  const effective = readMaxOldSpaceMb(env, execArgv);
  const target = Math.max(HEAP_MIN_MB, configured ?? 0);
  if (effective !== undefined && effective >= target) {
    return { status: "ok", label: `heap ${effective} MB` };
  }
  return {
    status: "warn",
    label: `heap ${effective ?? "default"} MB < ${target} at concurrency ${concurrency}`,
    detail: `${harness} runs in-process; ${HEAP_CONCURRENCY_THRESHOLD}+ concurrent sessions need a bigger heap.`,
    fix: `export NODE_OPTIONS=--max-old-space-size=${target}`,
  };
}

async function buildHarnessRow(
  harness: string,
  options: Required<
    Pick<HarnessProbeOptions, "env" | "resolvePackage" | "which" | "execArgv" | "fetchImpl">
  > &
    HarnessProbeOptions,
  providerProbeCache: Map<string, Promise<ProviderProbeResult>>,
): Promise<HarnessProbeRow> {
  const { env, resolvePackage, which, execArgv } = options;
  const config = options.config;
  const required =
    (options.requested?.includes(harness) ?? false) || config?.defaults.harness === harness;
  const harnessConfig = config?.harnesses?.[harness];
  const globalConcurrency = options.concurrency ?? config?.defaults.concurrency ?? 3;

  // Provider comes from the first configured/default model of the harness.
  const models =
    harnessConfig?.models ??
    env[`EVAL_${harness.toUpperCase()}_MODELS`]
      ?.split(",")
      .map((m) => m.trim())
      .filter(Boolean) ??
    getBenchHarness(harness).defaultModels ??
    [];
  const provider =
    harness === "stagehand"
      ? Object.keys(PROVIDER_KEY_ENV).find((p) => keyProbe(p, env).status === "ok")
      : providerFromModel(models[0]);

  let binary: Probe;
  let extra: Probe = skipped();
  switch (harness) {
    case "stagehand":
      binary = skipped();
      if (config?.defaults.env === "browserbase") {
        const bbOk = Boolean(env.BROWSERBASE_API_KEY?.trim() || env.BB_API_KEY?.trim());
        extra = bbOk
          ? { status: "ok", label: "BB keys" }
          : {
              status: "fail",
              label: "BB keys missing",
              detail: "defaults.env=browserbase but BROWSERBASE_API_KEY is not set.",
              fix: "source ~/.envs/prod.env",
            };
      }
      break;
    case "claude_code": {
      const sdk = resolvePackage("@anthropic-ai/claude-agent-sdk");
      const executable = env.EVAL_CLAUDE_CODE_EXECUTABLE?.trim();
      if (executable && !isExecutable(executable)) {
        binary = {
          status: "fail",
          label: "EVAL_CLAUDE_CODE_EXECUTABLE",
          detail: `EVAL_CLAUDE_CODE_EXECUTABLE=${executable} is not an executable file.`,
          fix: "unset EVAL_CLAUDE_CODE_EXECUTABLE (the SDK bundles its own) or point it at a real binary",
        };
      } else {
        binary = sdk
          ? { status: "ok", label: "sdk" }
          : {
              status: "fail",
              label: "sdk missing",
              detail: "@anthropic-ai/claude-agent-sdk not resolvable.",
              fix: "pnpm install",
            };
      }
      break;
    }
    case "codex": {
      const override = env.EVAL_CODEX_PATH?.trim();
      if (override) {
        binary = isExecutable(override)
          ? { status: "ok", label: "EVAL_CODEX_PATH" }
          : {
              status: "fail",
              label: "EVAL_CODEX_PATH",
              detail: `EVAL_CODEX_PATH=${override} is not an executable file.`,
              fix: "export EVAL_CODEX_PATH=$(which codex)",
            };
      } else {
        binary = resolvePackage("@openai/codex-sdk")
          ? { status: "ok", label: "vendored" }
          : {
              status: "fail",
              label: "codex missing",
              detail:
                "@openai/codex-sdk (vendored binary) not resolvable and EVAL_CODEX_PATH unset.",
              fix: "pnpm install, or export EVAL_CODEX_PATH=$(which codex)",
            };
      }
      const cwd = process.cwd();
      extra = isWritableDir(cwd)
        ? { status: "ok", label: "CODEX_HOME writable" }
        : {
            status: "fail",
            label: "CODEX_HOME not writable",
            detail: `Codex sessions create ${path.join(cwd, ".codex-home")} per run.`,
            fix: `chmod u+w ${cwd}`,
          };
      break;
    }
    case "mastra":
    case "pi":
      binary = { status: "ok", label: "in-process" };
      extra = heapProbe(
        harness,
        env,
        execArgv,
        effectiveWidth(globalConcurrency, providerFromModel(models[0]), config, env),
        harnessConfig?.nodeOptions,
      );
      break;
    case "eve":
      binary = resolvePackage("@browserbasehq/stagehand-integrations-eve-sdk")
        ? { status: "ok", label: "sdk" }
        : {
            status: "fail",
            label: "sdk missing",
            detail: "@browserbasehq/stagehand-integrations-eve-sdk not resolvable.",
            fix: "pnpm install",
          };
      break;
    case "deepagents": {
      const uv = env.STAGEHAND_DEEPAGENTS_UV?.trim() || "uv";
      const found = path.isAbsolute(uv) ? (isExecutable(uv) ? uv : undefined) : which(uv);
      binary = found
        ? { status: "ok", label: "uv" }
        : {
            status: "fail",
            label: "uv missing",
            detail: "uv is not on PATH (or STAGEHAND_DEEPAGENTS_UV points nowhere).",
            fix: "curl -LsSf https://astral.sh/uv/install.sh | sh",
          };
      extra = {
        status: "unknown",
        label: "python env",
        detail:
          "run `uv sync --locked --check` in the runner project to confirm the env is synced.",
        fix: "uv sync --locked --project packages/integrations/deepagents-sdk/runner",
      };
      break;
    }
    default:
      binary = skipped();
  }

  const key = keyProbe(provider, env);
  let probe: Probe = skipped();
  if (options.probe && key.status === "ok" && provider && key.value) {
    const cached =
      providerProbeCache.get(provider) ?? probeProvider(provider, key.value, options.fetchImpl);
    providerProbeCache.set(provider, cached);
    const keyFile = fileForKey(key.label, options.envReport);
    probe = probeFromResult(await cached, key.label, keyFile);
  }

  const { value: _value, ...keyWithoutValue } = key;
  const status = worst(binary.status, keyWithoutValue.status, probe.status, extra.status);
  return { harness, required, binary, key: keyWithoutValue, probe, extra, status };
}

function fileForKey(name: string, report: EvalsEnvReport | undefined): string | undefined {
  const kind = report?.sources.get(name);
  return report?.files.find((file) => file.kind === kind)?.path;
}

async function buildVerifierRow(
  options: Required<Pick<HarnessProbeOptions, "env" | "fetchImpl">> & HarnessProbeOptions,
): Promise<NamedProbeRow> {
  const judge = resolveVerifierModel(options.env);
  const provider = providerFromModel(judge.modelName);
  const key = keyProbe(provider, options.env);
  const probes: Probe[] = [];
  const { value, ...keyProbeOnly } = key;
  probes.push(keyProbeOnly);
  if (options.probe && key.status === "ok" && value) {
    const result = await probeJudge(judge.modelName, value, options.fetchImpl);
    if (result.retired) {
      probes.push({
        status: "fail",
        label: "model not found",
        detail: `${judge.modelName} is not served any more — every rubric criterion would fail with "Fused judgment call failed" and runs would exit 1 as dead-judge.`,
        fix: "evals config verifier set model google/gemini-3.5-flash",
      });
    } else {
      probes.push(probeFromResult(result, key.label, fileForKey(key.label, options.envReport)));
    }
  } else {
    probes.push(skipped());
  }
  const gate = options.env.EVAL_MAX_UNVERIFIABLE_CRITERIA?.trim();
  probes.push({
    status: "ok",
    label: gate ? `gate ${gate}` : "gate unset — report only",
  });
  return {
    name: "verifier",
    probes,
    status: worst(...probes.map((probe) => probe.status)),
    detail: `${judge.modelName} (${judge.source === "env" ? "EVAL_VERIFIER_MODEL" : "default"})`,
  };
}

async function buildBrowserbaseRow(
  options: Required<Pick<HarnessProbeOptions, "env" | "fetchImpl">> & HarnessProbeOptions,
): Promise<NamedProbeRow> {
  const env = options.env;
  const apiKey = env.BROWSERBASE_API_KEY?.trim() || env.BB_API_KEY?.trim();
  const projectId = env.BROWSERBASE_PROJECT_ID?.trim() || env.BB_PROJECT_ID?.trim();
  const probes: Probe[] = [];
  const missing = [
    ...(apiKey ? [] : ["BROWSERBASE_API_KEY"]),
    ...(projectId ? [] : ["BROWSERBASE_PROJECT_ID"]),
  ];
  probes.push(
    missing.length === 0
      ? { status: "ok", label: "both keys" }
      : {
          status: options.config?.defaults.env === "browserbase" ? "fail" : "warn",
          label: `${missing.join(" + ")} missing`,
          fix: "source ~/.envs/prod.env",
        },
  );
  if (options.probe && apiKey && projectId) {
    try {
      const res = await options.fetchImpl(
        `https://api.browserbase.com/v1/projects/${encodeURIComponent(projectId)}`,
        { headers: { "x-bb-api-key": apiKey } },
      );
      probes.push(
        res.ok
          ? { status: "ok", label: String(res.status) }
          : {
              status: "fail",
              label: String(res.status),
              detail:
                res.status === 401 || res.status === 403
                  ? "Browserbase rejected the key."
                  : res.status === 404
                    ? "Project not found for this key."
                    : `HTTP ${res.status}`,
              fix: "source ~/.envs/prod.env",
            },
      );
    } catch (error) {
      probes.push({ status: "fail", label: "error", detail: (error as Error).message });
    }
  } else {
    probes.push(skipped());
  }
  return { name: "browserbase", probes, status: worst(...probes.map((probe) => probe.status)) };
}

function buildEnvironmentReport(
  env: NodeJS.ProcessEnv,
  report: EvalsEnvReport | undefined,
): EnvironmentReport {
  // Same rule the runner applies: VERIFIER_PERSIST_TRAJECTORIES wins over CI.
  const persist = env.VERIFIER_PERSIST_TRAJECTORIES?.toLowerCase();
  const ci = Boolean(env.CI) && persist !== "1" && persist !== "true";
  return {
    files: (report?.files ?? []).map((file) => ({
      kind: file.kind,
      path: file.path,
      loaded: file.loaded,
      applied: file.applied.length,
    })),
    shadowed: report?.shadowed ?? [],
    ci: ci ? { set: true, fix: "unset CI, or VERIFIER_PERSIST_TRAJECTORIES=1" } : { set: false },
    status: ci || (report?.shadowed.length ?? 0) > 0 ? "warn" : "ok",
  };
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

export async function buildHarnessMatrix(
  options: HarnessProbeOptions = {},
): Promise<HarnessMatrix> {
  const env = options.env ?? process.env;
  const resolved = {
    ...options,
    env,
    fetchImpl: options.fetchImpl ?? fetch,
    resolvePackage: options.resolvePackage ?? defaultResolvePackage,
    which: options.which ?? ((binary: string) => defaultWhich(binary, env)),
    execArgv: options.execArgv ?? process.execArgv,
    envReport: options.envReport ?? getEvalsEnvReport(),
  };
  const executable = listExecutableBenchHarnesses();
  const requested = options.requested?.filter((h) => h !== "all");
  const candidates = requested && requested.length > 0 ? requested : executable;
  const skippedHarnesses = candidates.filter((h) => UNPROBED_HARNESSES.has(h));
  const rows = candidates.filter((h) => executable.includes(h) && !UNPROBED_HARNESSES.has(h));

  const cache = new Map<string, Promise<ProviderProbeResult>>();
  const harnesses: HarnessProbeRow[] = [];
  for (const harness of rows) {
    harnesses.push(await buildHarnessRow(harness, resolved, cache));
  }
  return {
    harnesses,
    verifier: await buildVerifierRow(resolved),
    browserbase: await buildBrowserbaseRow(resolved),
    environment: buildEnvironmentReport(env, resolved.envReport),
    skipped: skippedHarnesses,
  };
}

/**
 * Reasons that push the doctor verdict, from the matrix.
 *
 * Only what the user is about to run can fail the verdict: rows for
 * requested harnesses (`--harness` or `defaults.harness`) and, when any
 * harness was requested, the verifier and Browserbase rows. Everything else
 * is rendered in the matrix but stays informational so a developer with one
 * provider key is not nagged about the eight harnesses they never run.
 * Shadowed env keys always warn — they are real misconfigurations.
 */
export function harnessMatrixReasons(matrix: HarnessMatrix): {
  failures: string[];
  warnings: string[];
} {
  const failures: string[] = [];
  const warnings: string[] = [];
  const describe = (scope: string, probe: Probe) =>
    `${scope}: ${probe.detail ?? probe.label}${probe.fix ? ` → ${probe.fix}` : ""}`;

  const anyRequested = matrix.harnesses.some((row) => row.required);
  for (const row of matrix.harnesses) {
    if (!row.required) continue;
    for (const probe of [row.binary, row.key, row.probe, row.extra]) {
      if (probe.status === "fail") failures.push(describe(row.harness, probe));
      else if (probe.status === "warn") warnings.push(describe(row.harness, probe));
    }
  }
  if (anyRequested) {
    for (const named of [matrix.verifier, matrix.browserbase]) {
      for (const probe of named.probes) {
        if (probe.status === "fail") failures.push(describe(named.name, probe));
        else if (probe.status === "warn") warnings.push(describe(named.name, probe));
      }
    }
  }
  for (const shadow of matrix.environment.shadowed) {
    const winner = shadow.by === "shell" ? "shell export" : `${shadow.by} .env`;
    warnings.push(`${shadow.name} differs between ${winner} and ${shadow.file}; ${winner} wins`);
  }
  return { failures, warnings };
}

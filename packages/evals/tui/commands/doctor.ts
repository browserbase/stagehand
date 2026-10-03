/**
 * `evals doctor` — on-demand health report.
 *
 * The single canonical surface for env-key status. Replaces what earlier
 * drafts proposed as an always-on status row in the REPL; the REPL itself
 * only emits a single inline line when zero provider keys are present
 * (see tui/welcomeStatus.ts).
 *
 * Sections:
 *   1. Runtime    — node version, Stagehand version, mode (source/dist)
 *   2. Config     — evals.config.json path, defaults.env/trials/concurrency, core.*
 *   3. Env files  — which .env files the runner loaded, shadowed keys, CI
 *   4. Discovery  — total tasks + core/bench split
 *   5. API keys   — full matrix from snapshotEnv() with source provenance
 *   6. Harnesses  — per-harness probe matrix (binary / key / probe / extra),
 *                   verifier + Browserbase rows (tui/commands/doctorHarnesses.ts)
 *   7. Verdict    — ok | warn | fail; exit code 0 | 0 | 1 (sans --json)
 *
 * Flags:
 *   --json           machine-readable output, always exit 0
 *   --harness a,b    narrow the harness matrix; failures in requested rows fail the verdict
 *   --probe          run the network probes (provider key validity, judge model, BB project)
 *   --help/-h        prints printDoctorHelp()
 */

import fs from "node:fs";
import path from "node:path";
import { bold, cyan, dim, gray, green, red, yellow, padRight, visibleLength } from "../format.js";
import { readConfig, resolveConfigPath, type TracingConfigSection } from "./config.js";
import { resolveTracingValue } from "./tracing.js";
import { resolveKey, snapshotEnv, type EnvSnapshot } from "../welcomeStatus.js";
import { getPackageRootDir, getRuntimeTasksRoot } from "../../runtimePaths.js";
import { discoverTasks } from "../../framework/discovery.js";
import type { TaskRegistry } from "../../framework/types.js";
import {
  buildHarnessMatrix,
  harnessMatrixReasons,
  type HarnessMatrix,
  type Probe,
  type ProbeStatus,
} from "./doctorHarnesses.js";
import { isBenchHarness, listBenchHarnesses } from "../../framework/benchHarness.js";

type Verdict = "ok" | "warn" | "fail";

type RuntimeInfo = {
  node: string;
  stagehand: string | null;
  mode: "source" | "dist";
};

type ConfigSummary = {
  path: string;
  env: string | null;
  trials: number | null;
  concurrency: number | null;
  core: { tool: string | null; startup: string | null };
};

type TracingValue = {
  value: string | null;
  source: "env" | "config" | "none";
  /** Set when the configured value was unrecognized and `value` is the runtime fallback. */
  invalid?: string;
};

/** Effective trace-sink settings (env > evals.config.json `tracing` > none). */
type TracingSummary = {
  transport: TracingValue;
  braintrustProject: TracingValue;
  langsmithProject: TracingValue;
  /** LangSmith export will actually happen: otel transport + key + LANGSMITH_TRACING=true. */
  langsmithEnabled: boolean;
};

type DiscoverySummary = {
  ok: boolean;
  total: number;
  core: number;
  bench: number;
  error?: string;
  root: string;
};

type DoctorReport = {
  verdict: Verdict;
  runtime: RuntimeInfo;
  config: ConfigSummary;
  discovery: DiscoverySummary;
  tracing: TracingSummary;
  keys: EnvSnapshot;
  harnesses: HarnessMatrix;
  reasons: string[];
};

type DoctorFlags = {
  json: boolean;
  probe: boolean;
  requested?: string[];
};

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------

export function printDoctorHelp(): void {
  const HELP_COL = 28;
  const row = (left: string, right: string): string => `    ${padRight(left, HELP_COL)} ${right}`;
  console.log(
    [
      "",
      `  ${bold("evals doctor")} ${dim("[options]")}`,
      "",
      "  Health report: env-key matrix, config locations, discovered tasks, runtime,",
      "  and a per-harness probe matrix with the command that fixes each failure.",
      "",
      `  ${bold("Options:")}`,
      "",
      row(cyan("--json"), "Emit machine-readable JSON (always exits 0)"),
      row(
        `${cyan("--harness")} ${dim("<a,b|all>")}`,
        "Narrow the harness matrix; failures in requested rows fail the verdict",
      ),
      row(cyan("--probe"), "Run network probes: provider key validity, judge model, BB project"),
      row(cyan("--help, -h"), "Show this help"),
      "",
      `  ${bold("Examples:")}`,
      "",
      `    ${dim("$")} evals doctor --harness claude_code,codex --probe`,
      `    ${dim("$")} evals doctor --json`,
      "",
      `  ${bold("Aliases:")} ${gray("evals health")}`,
      "",
      `  ${bold("Exit codes:")}`,
      "",
      row(gray("0"), "ok / warn"),
      row(
        gray("1"),
        "fail (zero provider keys, broken env=browserbase, requested harness unusable)",
      ),
      "",
    ].join("\n"),
  );
}

// ---------------------------------------------------------------------------
// Report assembly
// ---------------------------------------------------------------------------

function readStagehandVersion(): string | null {
  try {
    const repoRoot = path.dirname(getPackageRootDir());
    const corePkgPath = path.join(repoRoot, "core", "package.json");
    const corePkg = JSON.parse(fs.readFileSync(corePkgPath, "utf-8"));
    return typeof corePkg.version === "string" ? corePkg.version : null;
  } catch {
    return null;
  }
}

function detectMode(entryDir: string): "source" | "dist" {
  // Anchor on the actual built location (`packages/evals/dist/cli`) so a
  // user whose checkout happens to live under a path containing `/dist/`
  // (e.g. `~/work/dist/stagehand/...`) isn't misclassified.
  return entryDir.endsWith("/dist/cli") || entryDir.endsWith("\\dist\\cli") ? "dist" : "source";
}

function summarizeConfig(entryDir: string): ConfigSummary {
  let env: string | null = null;
  let trials: number | null = null;
  let concurrency: number | null = null;
  let coreTool: string | null = null;
  let coreStartup: string | null = null;
  try {
    const c = readConfig(entryDir);
    env = (c.defaults.env as string | null | undefined) ?? null;
    trials = (c.defaults.trials as number | null | undefined) ?? null;
    concurrency = (c.defaults.concurrency as number | null | undefined) ?? null;
    coreTool = c.core?.tool ?? null;
    coreStartup = c.core?.startup ?? null;
  } catch {
    // Leave as nulls — the path is still useful for the user to fix.
  }
  return {
    path: resolveConfigPath(entryDir),
    env,
    trials,
    concurrency,
    core: { tool: coreTool, startup: coreStartup },
  };
}

function summarizeTracing(entryDir: string, keys: EnvSnapshot): TracingSummary {
  let tracing: TracingConfigSection | undefined;
  try {
    tracing = readConfig(entryDir).tracing;
  } catch {
    // Missing/invalid config is reported under Config; fall through to env-only.
  }
  const pick = (key: keyof TracingConfigSection): TracingValue => {
    const r = resolveTracingValue(key, tracing);
    return { value: r.value ?? null, source: r.source };
  };
  // Mirror resolveTraceTransport(): anything other than "otel" runs native, so
  // report the fallback rather than echoing a typo as if it were effective.
  const transport = pick("transport");
  if (transport.value !== null && transport.value !== "otel" && transport.value !== "native") {
    transport.invalid = transport.value;
    transport.value = "native";
  }
  // Same process.env + packages/evals/.env resolution as the Keys block, so the
  // two sections cannot disagree about whether a LangSmith key exists.
  const langsmithEnabled =
    transport.value === "otel" &&
    keys.langsmith.state === "set" &&
    resolveKey("LANGSMITH_TRACING").value === "true";
  return {
    transport,
    braintrustProject: pick("braintrustProject"),
    langsmithProject: pick("langsmithProject"),
    langsmithEnabled,
  };
}

async function summarizeDiscovery(): Promise<DiscoverySummary> {
  const root = getRuntimeTasksRoot();
  try {
    const registry: TaskRegistry = await discoverTasks(root, false);
    const core = registry.byTier.get("core")?.length ?? 0;
    const bench = registry.byTier.get("bench")?.length ?? 0;
    return { ok: true, total: registry.tasks.length, core, bench, root };
  } catch (err) {
    return {
      ok: false,
      total: 0,
      core: 0,
      bench: 0,
      error: (err as Error).message,
      root,
    };
  }
}

/**
 * Verdict rules:
 *   fail  — zero provider keys, OR defaults.env=browserbase with both BB
 *           vars missing, OR discovery threw.
 *   warn  — at least one provider key present, but Braintrust missing or
 *           BB partial (only one of two BB vars set).
 *   ok    — otherwise.
 */
function computeVerdict(
  keys: EnvSnapshot,
  config: ConfigSummary,
  discovery: DiscoverySummary,
): { verdict: Verdict; reasons: string[] } {
  const reasons: string[] = [];

  if (!discovery.ok) {
    reasons.push(`Discovery failed: ${discovery.error ?? "unknown error"}`);
  }

  const zeroProviders =
    keys.openai.state === "missing" &&
    keys.anthropic.state === "missing" &&
    keys.google.state === "missing";
  if (zeroProviders) {
    reasons.push("No provider API key found (OpenAI / Anthropic / Google all missing).");
  }

  const envIsBrowserbase = config.env === "browserbase";
  const bothBBMissing =
    keys.browserbase.apiKey === "missing" && keys.browserbase.projectId === "missing";
  if (envIsBrowserbase && bothBBMissing) {
    reasons.push(
      "env=browserbase but both BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID are missing.",
    );
  }

  if (!discovery.ok || zeroProviders || (envIsBrowserbase && bothBBMissing)) {
    return { verdict: "fail", reasons };
  }

  const partialBB =
    (keys.browserbase.apiKey === "set" && keys.browserbase.projectId === "missing") ||
    (keys.browserbase.apiKey === "missing" && keys.browserbase.projectId === "set");
  if (partialBB) {
    reasons.push("Browserbase is partially configured (one of API key / project ID is missing).");
  }
  if (keys.braintrust.state === "missing") {
    reasons.push("BRAINTRUST_API_KEY missing — `experiments` commands will fail.");
  }

  if (partialBB || keys.braintrust.state === "missing") {
    return { verdict: "warn", reasons };
  }

  return { verdict: "ok", reasons };
}

async function buildReport(entryDir: string, flags: DoctorFlags): Promise<DoctorReport> {
  const runtime: RuntimeInfo = {
    node: process.version,
    stagehand: readStagehandVersion(),
    mode: detectMode(entryDir),
  };
  const config = summarizeConfig(entryDir);
  const keys = snapshotEnv();
  const tracing = summarizeTracing(entryDir, keys);
  const discovery = await summarizeDiscovery();
  const computed = computeVerdict(keys, config, discovery);
  let verdict = computed.verdict;
  const reasons = [...computed.reasons];

  let fullConfig;
  try {
    fullConfig = readConfig(entryDir);
  } catch {
    fullConfig = undefined;
  }
  const harnesses = await buildHarnessMatrix({
    config: fullConfig,
    requested: flags.requested,
    probe: flags.probe,
  });
  const matrixReasons = harnessMatrixReasons(harnesses);
  if (matrixReasons.failures.length > 0) verdict = "fail";
  else if (matrixReasons.warnings.length > 0 && verdict === "ok") verdict = "warn";
  reasons.push(...matrixReasons.failures, ...matrixReasons.warnings);
  if (tracing.transport.invalid) {
    if (verdict === "ok") verdict = "warn";
    reasons.push(
      `Unrecognized EVAL_TRACE_TRANSPORT="${tracing.transport.invalid}" (expected "native" or "otel") — the runner falls back to native.`,
    );
  }
  if (
    tracing.transport.value === "otel" &&
    keys.braintrust.state === "missing" &&
    !tracing.langsmithEnabled
  ) {
    if (verdict === "ok") verdict = "warn";
    reasons.push(
      "EVAL_TRACE_TRANSPORT=otel but no sink is configured — set BRAINTRUST_API_KEY and/or LANGSMITH_API_KEY + LANGSMITH_TRACING=true.",
    );
  }
  return { verdict, runtime, config, tracing, discovery, keys, harnesses, reasons };
}

// ---------------------------------------------------------------------------
// Renderers
// ---------------------------------------------------------------------------

function keyRow(
  label: string,
  entry: { state: "set" | "missing"; source: string },
  note?: string,
): string {
  const value =
    entry.state === "set"
      ? `${green("✓ set")}            ${dim(`(${entry.source})`)}`
      : red("✗ missing");
  const suffix = note ? `        ${dim(note)}` : "";
  return `    ${padRight(label, 30)} ${value}${suffix}`;
}

function tracingCell(v: TracingValue, fallback: string): string {
  if (v.value === null) return gray(`(default: ${fallback})`);
  if (v.invalid)
    return `${cyan(v.value)}  ${yellow(`(fallback — ignored invalid "${v.invalid}" from ${v.source})`)}`;
  return `${cyan(v.value)}  ${dim(`(${v.source})`)}`;
}

function renderHuman(report: DoctorReport): void {
  const r = report;
  console.log("");
  console.log(`  ${bold("Stagehand evals · doctor")}`);
  console.log("");

  console.log(`  ${bold("Runtime")}`);
  console.log(`    ${padRight("Node", 15)} ${r.runtime.node}`);
  console.log(
    `    ${padRight("Stagehand", 15)} ${r.runtime.stagehand ?? gray("(unknown)")}     ${dim("(packages/core/package.json)")}`,
  );
  console.log(`    ${padRight("Mode", 15)} ${r.runtime.mode}`);
  console.log("");

  console.log(`  ${bold("Config")}`);
  console.log(`    ${padRight("evals.config.json", 22)} ${dim(r.config.path)}`);
  console.log(`    ${padRight("env", 22)} ${cyan(r.config.env ?? "local")}`);
  console.log(`    ${padRight("trials", 22)} ${cyan(String(r.config.trials ?? 3))}`);
  console.log(`    ${padRight("concurrency", 22)} ${cyan(String(r.config.concurrency ?? 3))}`);
  console.log(
    `    ${padRight("core.tool", 22)} ${
      r.config.core.tool ? cyan(r.config.core.tool) : gray("(runner default: understudy_code)")
    }`,
  );
  if (r.config.core.startup) {
    console.log(`    ${padRight("core.startup", 22)} ${cyan(r.config.core.startup)}`);
  }
  console.log("");

  renderEnvFiles(r.harnesses);

  console.log(`  ${bold("Tracing")}`);
  console.log(`    ${padRight("transport", 22)} ${tracingCell(r.tracing.transport, "native")}`);
  console.log(
    `    ${padRight("braintrust project", 22)} ${tracingCell(r.tracing.braintrustProject, "stagehand[-core][-dev]")}`,
  );
  console.log(
    `    ${padRight("langsmith project", 22)} ${tracingCell(r.tracing.langsmithProject, "workspace default")}  ${dim(r.tracing.langsmithEnabled ? "(export on)" : "(export off)")}`,
  );
  console.log("");

  console.log(`  ${bold("Discovery")}`);
  if (r.discovery.ok) {
    console.log(
      `    ${padRight("Tasks", 22)} ${cyan(String(r.discovery.total))}  ${dim(`(core: ${r.discovery.core} · bench: ${r.discovery.bench})`)}`,
    );
    console.log(`    ${padRight("Tasks root", 22)} ${dim(r.discovery.root)}`);
  } else {
    console.log(`    ${red("✗ failed")} ${dim(r.discovery.error ?? "")}`);
    console.log(`    ${padRight("Tasks root", 22)} ${dim(r.discovery.root)}`);
  }
  console.log("");

  console.log(`  ${bold("API keys")}`);
  console.log(keyRow("OPENAI_API_KEY", r.keys.openai));
  console.log(keyRow("ANTHROPIC_API_KEY", r.keys.anthropic));
  const googleLabel = r.keys.google.var ?? "GOOGLE_GENERATIVE_AI_API_KEY";
  console.log(
    keyRow(googleLabel, {
      state: r.keys.google.state,
      source: r.keys.google.source,
    }),
  );
  console.log(
    `    ${padRight("BROWSERBASE_API_KEY", 30)} ${
      r.keys.browserbase.apiKey === "set" ? green("✓ set") : red("✗ missing")
    }${r.keys.browserbase.viaAlias ? `        ${dim("(via BB_API_KEY)")}` : ""}`,
  );
  console.log(
    `    ${padRight("BROWSERBASE_PROJECT_ID", 30)} ${
      r.keys.browserbase.projectId === "set" ? green("✓ set") : red("✗ missing")
    }`,
  );
  console.log(keyRow("BRAINTRUST_API_KEY", r.keys.braintrust, "(needed for `experiments`)"));
  const langsmithLabel = r.keys.langsmith.var ?? "LANGSMITH_API_KEY";
  console.log(
    keyRow(langsmithLabel, r.keys.langsmith, "(optional; LANGCHAIN_API_KEY also supported)"),
  );
  console.log("");

  renderHarnessMatrix(r.harnesses);

  console.log(`  ${bold("Status")}`);
  if (r.verdict === "ok") {
    console.log(`    ${green("✓ ok")}`);
  } else if (r.verdict === "warn") {
    console.log(`    ${yellow("⚠ warn")}`);
  } else {
    console.log(`    ${red("✗ fail")}`);
  }
  for (const reason of r.reasons) {
    console.log(`      ${dim("— " + reason)}`);
  }
  console.log("");

  if (r.verdict !== "ok") {
    console.log(
      `  ${dim("To set keys: edit")} ${cyan(path.join(getPackageRootDir(), ".env"))} ${dim("or export them in your shell.")}`,
    );
    console.log("");
  }
}

function probeMark(probe: Probe): string {
  const icon: Record<ProbeStatus, string> = {
    ok: green("✓"),
    warn: yellow("⚠"),
    fail: red("✗"),
    unknown: gray("?"),
    skipped: gray("—"),
  };
  return probe.status === "skipped" ? gray("—") : `${icon[probe.status]} ${probe.label}`;
}

function renderProbeNotes(probes: Probe[], indent = "                  "): void {
  for (const probe of probes) {
    if (probe.status === "ok" || probe.status === "skipped") continue;
    if (probe.detail) console.log(`${indent}${dim("→ " + probe.detail)}`);
    if (probe.fix) console.log(`${indent}  ${cyan(probe.fix)}`);
  }
}

function renderEnvFiles(matrix: HarnessMatrix): void {
  const env = matrix.environment;
  console.log(`  ${bold("Env files")}`);
  if (env.files.length === 0) {
    console.log(`    ${dim("(loader did not run — keys come from the shell only)")}`);
  }
  for (const file of env.files) {
    const label = file.kind === "package" ? "package" : "cwd";
    const state = file.loaded
      ? `${green("✓ loaded")} ${dim(`(${file.applied} key${file.applied === 1 ? "" : "s"} applied)`)}`
      : gray("not present");
    console.log(`    ${padRight(label, 22)} ${dim(file.path)}  ${state}`);
  }
  for (const shadow of env.shadowed) {
    const winner = shadow.by === "shell" ? "shell export" : `${shadow.by} .env`;
    console.log(
      `    ${padRight("shadowed", 22)} ${yellow(shadow.name)} ${dim(`differs between ${winner} and ${shadow.file}; ${winner} wins`)}`,
    );
  }
  if (env.ci.set) {
    console.log(
      `    ${padRight("CI", 22)} ${yellow("CI is set — trajectories will NOT be persisted")}  ${dim("→")} ${cyan(env.ci.fix ?? "")}`,
    );
  }
  console.log("");
}

function renderHarnessMatrix(matrix: HarnessMatrix): void {
  console.log(`  ${bold("Harnesses")}`);
  const widths = { harness: 13, binary: 22, key: 30, probe: 14 };
  console.log(
    `    ${dim(padRight("harness", widths.harness))} ${dim(padRight("binary", widths.binary))} ${dim(padRight("key", widths.key))} ${dim(padRight("probe", widths.probe))} ${dim("extra")}`,
  );
  const pad = (text: string, width: number) =>
    `${text}${" ".repeat(Math.max(0, width - visibleLength(text)))}`;
  for (const row of matrix.harnesses) {
    const name = row.required ? bold(row.harness) : row.harness;
    console.log(
      `    ${pad(name, widths.harness)} ${pad(probeMark(row.binary), widths.binary)} ${pad(probeMark(row.key), widths.key)} ${pad(probeMark(row.probe), widths.probe)} ${probeMark(row.extra)}`,
    );
    renderProbeNotes([row.binary, row.key, row.probe, row.extra]);
  }
  if (matrix.skipped.length > 0) {
    console.log(
      `    ${dim(`not probed: ${matrix.skipped.join(", ")} — auth lives in the CLI; run it manually`)}`,
    );
  }
  console.log("");

  console.log(`  ${bold("Verifier")}`);
  console.log(`    ${padRight("judge", 22)} ${cyan(matrix.verifier.detail ?? "")}`);
  console.log(`    ${padRight("probes", 22)} ${matrix.verifier.probes.map(probeMark).join("   ")}`);
  renderProbeNotes(matrix.verifier.probes, "      ");
  console.log("");

  console.log(`  ${bold("Browserbase")}`);
  console.log(
    `    ${padRight("probes", 22)} ${matrix.browserbase.probes.map(probeMark).join("   ")}`,
  );
  renderProbeNotes(matrix.browserbase.probes, "      ");
  console.log("");
}

function renderJson(report: DoctorReport): void {
  // Keep field order stable for downstream consumers.
  const out = {
    verdict: report.verdict,
    runtime: report.runtime,
    config: report.config,
    tracing: report.tracing,
    discovery: {
      ok: report.discovery.ok,
      total: report.discovery.total,
      core: report.discovery.core,
      bench: report.discovery.bench,
      root: report.discovery.root,
      ...(report.discovery.error ? { error: report.discovery.error } : {}),
    },
    keys: report.keys,
    harnesses: report.harnesses.harnesses,
    verifier: report.harnesses.verifier,
    browserbase: report.harnesses.browserbase,
    environment: report.harnesses.environment,
    unprobedHarnesses: report.harnesses.skipped,
    reasons: report.reasons,
  };
  console.log(JSON.stringify(out, null, 2));
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/** `--json`, `--probe`, `--harness a,b` (or `--harness=a,b`); unknown harness names are rejected. */
export function parseDoctorFlags(args: string[]): DoctorFlags | { error: string } {
  const flags: DoctorFlags = { json: false, probe: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--json") flags.json = true;
    else if (arg === "--probe") flags.probe = true;
    else if (arg === "--harness" || arg.startsWith("--harness=")) {
      const raw = arg.includes("=") ? arg.slice("--harness=".length) : args[++i];
      if (!raw) return { error: "--harness needs a comma-separated list of harnesses, or `all`" };
      const names = raw
        .split(",")
        .map((name) => name.trim())
        .filter(Boolean);
      const unknown = names.filter((name) => name !== "all" && !isBenchHarness(name));
      if (unknown.length > 0) {
        return {
          error: `Unknown harness ${unknown.map((name) => `"${name}"`).join(", ")}. Registered: ${listBenchHarnesses().join(", ")}`,
        };
      }
      flags.requested = names;
    }
  }
  return flags;
}

export async function handleDoctor(args: string[], entryDir: string): Promise<number> {
  if (args.includes("--help") || args.includes("-h") || args[0] === "help") {
    printDoctorHelp();
    return 0;
  }

  const flags = parseDoctorFlags(args);
  if ("error" in flags) {
    console.error(red(`  ${flags.error}`));
    return 1;
  }

  const report = await buildReport(entryDir, flags);

  if (flags.json) {
    renderJson(report);
    return 0; // --json always exits 0; verdict is in the payload
  }

  renderHuman(report);

  if (report.verdict === "fail") return 1;
  return 0;
}

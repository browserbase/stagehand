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
 *   3. Discovery  — total tasks + core/bench split
 *   4. API keys   — full matrix from snapshotEnv() with source provenance
 *   5. Verdict    — ok | warn | fail; exit code 0 | 0 | 1 (sans --json)
 *
 * Flags:
 *   --json     machine-readable output, always exit 0
 *   --help/-h  prints printDoctorHelp()
 *   --probe    HIDDEN. Issues a tiny no-op LLM call to verify the OpenAI key
 *              actually works. Used in CI; not advertised in --help.
 */

import fs from "node:fs";
import path from "node:path";
import {
  bold,
  cyan,
  dim,
  gray,
  green,
  red,
  yellow,
  padRight,
} from "../format.js";
import { readConfig, resolveConfigPath } from "./config.js";
import { resolveKey, snapshotEnv, type EnvSnapshot } from "../welcomeStatus.js";
import { getPackageRootDir, getRuntimeTasksRoot } from "../../runtimePaths.js";
import { discoverTasks } from "../../framework/discovery.js";
import type { TaskRegistry } from "../../framework/types.js";

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
  keys: EnvSnapshot;
  reasons: string[];
};

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------

export function printDoctorHelp(): void {
  const HELP_COL = 28;
  const row = (left: string, right: string): string =>
    `    ${padRight(left, HELP_COL)} ${right}`;
  console.log(
    [
      "",
      `  ${bold("evals doctor")} ${dim("[options]")}`,
      "",
      "  Health report: env-key matrix, config locations, discovered tasks, runtime.",
      "",
      `  ${bold("Options:")}`,
      "",
      row(cyan("--json"), "Emit machine-readable JSON (always exits 0)"),
      row(cyan("--help, -h"), "Show this help"),
      "",
      `  ${bold("Aliases:")} ${gray("evals health")}`,
      "",
      `  ${bold("Exit codes:")}`,
      "",
      row(gray("0"), "ok / warn"),
      row(gray("1"), "fail (zero provider keys, broken env=browserbase, etc.)"),
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
  return entryDir.endsWith("/dist/cli") || entryDir.endsWith("\\dist\\cli")
    ? "dist"
    : "source";
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
 * Verdict rules (plan §07):
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
    reasons.push(
      "No provider API key found (OpenAI / Anthropic / Google all missing).",
    );
  }

  const envIsBrowserbase = config.env === "browserbase";
  const bothBBMissing =
    keys.browserbase.apiKey === "missing" &&
    keys.browserbase.projectId === "missing";
  if (envIsBrowserbase && bothBBMissing) {
    reasons.push(
      "env=browserbase but both BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID are missing.",
    );
  }

  if (!discovery.ok || zeroProviders || (envIsBrowserbase && bothBBMissing)) {
    return { verdict: "fail", reasons };
  }

  const partialBB =
    (keys.browserbase.apiKey === "set" &&
      keys.browserbase.projectId === "missing") ||
    (keys.browserbase.apiKey === "missing" &&
      keys.browserbase.projectId === "set");
  if (partialBB) {
    reasons.push(
      "Browserbase is partially configured (one of API key / project ID is missing).",
    );
  }
  if (keys.braintrust.state === "missing") {
    reasons.push(
      "BRAINTRUST_API_KEY missing — `experiments` commands will fail.",
    );
  }

  if (partialBB || keys.braintrust.state === "missing") {
    return { verdict: "warn", reasons };
  }

  return { verdict: "ok", reasons };
}

async function buildReport(entryDir: string): Promise<DoctorReport> {
  const runtime: RuntimeInfo = {
    node: process.version,
    stagehand: readStagehandVersion(),
    mode: detectMode(entryDir),
  };
  const config = summarizeConfig(entryDir);
  const discovery = await summarizeDiscovery();
  const keys = snapshotEnv();
  const { verdict, reasons } = computeVerdict(keys, config, discovery);
  return { verdict, runtime, config, discovery, keys, reasons };
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
  console.log(
    `    ${padRight("trials", 22)} ${cyan(String(r.config.trials ?? 3))}`,
  );
  console.log(
    `    ${padRight("concurrency", 22)} ${cyan(String(r.config.concurrency ?? 3))}`,
  );
  console.log(
    `    ${padRight("core.tool", 22)} ${
      r.config.core.tool
        ? cyan(r.config.core.tool)
        : gray("(runner default: understudy_code)")
    }`,
  );
  if (r.config.core.startup) {
    console.log(
      `    ${padRight("core.startup", 22)} ${cyan(r.config.core.startup)}`,
    );
  }
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
  console.log(
    keyRow(
      "BRAINTRUST_API_KEY",
      r.keys.braintrust,
      "(needed for `experiments`)",
    ),
  );
  console.log("");

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

function renderJson(report: DoctorReport): void {
  // Keep field order stable for downstream consumers.
  const out = {
    verdict: report.verdict,
    runtime: report.runtime,
    config: report.config,
    discovery: {
      ok: report.discovery.ok,
      total: report.discovery.total,
      core: report.discovery.core,
      bench: report.discovery.bench,
      root: report.discovery.root,
      ...(report.discovery.error ? { error: report.discovery.error } : {}),
    },
    keys: report.keys,
    reasons: report.reasons,
  };
  console.log(JSON.stringify(out, null, 2));
}

// ---------------------------------------------------------------------------
// Probe (hidden)
// ---------------------------------------------------------------------------

async function runOpenAIProbe(
  keys: EnvSnapshot,
): Promise<{ ok: boolean; error?: string }> {
  if (keys.openai.state !== "set")
    return { ok: false, error: "OPENAI_API_KEY missing" };
  // Use the SAME resolution as the snapshot — i.e. check process.env AND
  // packages/evals/.env. If we only read process.env here, a key stored
  // only in the package-local .env would show "✓ set" in the snapshot but
  // probe with an empty bearer token and silently fail with an auth error.
  const { value: apiKey } = resolveKey("OPENAI_API_KEY");
  if (!apiKey) {
    return { ok: false, error: "OPENAI_API_KEY missing after resolution" };
  }
  // Tiny no-op model list call — cheaper than a chat completion.
  try {
    const res = await fetch("https://api.openai.com/v1/models?limit=1", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: (err as Error).message,
    };
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function handleDoctor(
  args: string[],
  entryDir: string,
): Promise<number> {
  if (args.includes("--help") || args.includes("-h") || args[0] === "help") {
    printDoctorHelp();
    return 0;
  }

  const wantJson = args.includes("--json");
  const wantProbe = args.includes("--probe");

  const report = await buildReport(entryDir);

  if (wantProbe) {
    const probeResult = await runOpenAIProbe(report.keys);
    if (!probeResult.ok) {
      report.reasons.push(`Probe failed: ${probeResult.error ?? "unknown"}`);
      report.verdict = "fail";
    }
  }

  if (wantJson) {
    renderJson(report);
    return 0; // --json always exits 0; verdict is in the payload
  }

  renderHuman(report);

  if (report.verdict === "fail") return 1;
  return 0;
}

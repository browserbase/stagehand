/**
 * Machine detection for the welcome flows — agent-benchmark edition.
 *
 * Agent benchmarks (agent/webvoyager, onlineMind2Web, webtailbench,
 * odysseysbench) need a model provider key AND a browser (local Chrome or
 * Browserbase). The plan says whether a REAL run is possible here; when it
 * isn't, flows replay scripted trajectories of real benchmark tasks instead
 * and the hand-off tells the user exactly what unlocks the real thing.
 */

import { resolveLocalChromeExecutablePath } from "../../core/targets/localChrome.js";
import { resolveKey, snapshotEnv, type EnvSnapshot } from "../welcomeStatus.js";

export type Provider = "openai" | "anthropic" | "google";
export type Browser = "local" | "browserbase";

/** Executable agent-suite harnesses and the key each one needs. */
export type AgentHarness = "claude_code" | "codex";

export type Plan =
  | { kind: "real"; browser: Browser; provider: Provider; harness: AgentHarness; reason: string }
  | { kind: "scripted"; reason: string };

export type Recommendation = {
  /** argv suffix without `evals`, or null when the next step is an env change only. */
  command: string | null;
  /** One human line. */
  line: string;
};

export type Machine = {
  keys: EnvSnapshot;
  providers: Provider[];
  chrome: string | null;
  browserbase: boolean;
  plan: Plan;
  recommend: Recommendation;
};

export const FIRST_BENCH_TARGET = "b:webvoyager";

/**
 * Keys that live only in packages/evals/.env are visible to detection (which
 * reads that file) but not to a run launched from the repo root (which reads
 * process.env). Promote them so the hand-off can actually authenticate.
 */
const RUNTIME_KEYS = [
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "GEMINI_API_KEY",
  "BROWSERBASE_API_KEY",
  "BROWSERBASE_PROJECT_ID",
  "BB_API_KEY",
  "BB_PROJECT_ID",
];
function promotePackageEnv(): void {
  for (const name of RUNTIME_KEYS) {
    if (process.env[name]) continue;
    const r = resolveKey(name);
    if (r.source === "package-dotenv" && r.value) process.env[name] = r.value;
  }
}

export function detectMachine(): Machine {
  promotePackageEnv();
  const keys = snapshotEnv();
  const providers: Provider[] = [];
  if (keys.openai.state === "set") providers.push("openai");
  if (keys.anthropic.state === "set") providers.push("anthropic");
  if (keys.google.state === "set") providers.push("google");
  let chrome: string | null = null;
  try {
    chrome = resolveLocalChromeExecutablePath() ?? null;
  } catch {
    chrome = null;
  }
  const browserbase = keys.browserbase.apiKey === "set" && keys.browserbase.projectId === "set";
  const { plan, recommend } = derivePlan({ chrome: chrome !== null, browserbase, providers });
  return { keys, providers, chrome, browserbase, plan, recommend };
}

/** The command the hand-off runs: three real WebVoyager cases through the harness the key can drive. */
export function firstRunCommand(plan: Extract<Plan, { kind: "real" }>): string {
  // Always explicit: evals.config.json may default `env` to the other one.
  return `run ${FIRST_BENCH_TARGET} -l 3 --harness ${plan.harness} -e ${plan.browser === "browserbase" ? "browserbase" : "local"}`;
}

/** Pure: can this machine run a real agent benchmark, and what should it do next? */
export function derivePlan(m: { chrome: boolean; browserbase: boolean; providers: Provider[] }): {
  plan: Plan;
  recommend: Recommendation;
} {
  const browser: Browser | null = m.chrome ? "local" : m.browserbase ? "browserbase" : null;
  // Agent suites run through an external harness; each is tied to a provider.
  // Anthropic → claude_code, OpenAI → codex. A Google key alone can't drive one.
  const harnessFor: Array<[Provider, AgentHarness]> = [
    ["anthropic", "claude_code"],
    ["openai", "codex"],
  ];
  const match = harnessFor.find(([p]) => m.providers.includes(p));
  if (browser && match) {
    const [provider, harness] = match;
    const plan: Plan = {
      kind: "real",
      browser,
      provider,
      harness,
      reason: `${providerLabel(provider)} key + ${browser === "local" ? "local Chrome" : "Browserbase"} — real agent runs are unlocked (${harness} harness)`,
    };
    return {
      plan,
      recommend: {
        command: firstRunCommand(plan),
        line: "Run three real WebVoyager cases (a few minutes, a few cents).",
      },
    };
  }
  const missing: string[] = [];
  if (!match) {
    missing.push(
      m.providers.includes("google")
        ? "an Anthropic or OpenAI key (agent suites run through claude_code or codex; a Google key can't drive them)"
        : "a provider key (ANTHROPIC_API_KEY or OPENAI_API_KEY)",
    );
  }
  if (!browser)
    missing.push(
      "a browser (install Google Chrome, or set BROWSERBASE_API_KEY + BROWSERBASE_PROJECT_ID for a hosted one)",
    );
  return {
    plan: {
      kind: "scripted",
      reason: `missing ${missing.join(" and ")} — replaying a recorded-style run`,
    },
    recommend: {
      command: "setup",
      line: `To run real agent benchmarks you still need ${missing.join(" and ")} — \`evals setup\` shows where.`,
    },
  };
}

export function providerLabel(p: Provider): string {
  return p === "openai" ? "OpenAI" : p === "anthropic" ? "Anthropic" : "Google";
}

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
import { snapshotEnv, type EnvSnapshot } from "../welcomeStatus.js";

export type Provider = "openai" | "anthropic" | "google";
export type Browser = "local" | "browserbase";

export type Plan =
  | { kind: "real"; browser: Browser; provider: Provider; reason: string }
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

export function detectMachine(): Machine {
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

/** Pure: can this machine run a real agent benchmark, and what should it do next? */
export function derivePlan(m: { chrome: boolean; browserbase: boolean; providers: Provider[] }): {
  plan: Plan;
  recommend: Recommendation;
} {
  const browser: Browser | null = m.chrome ? "local" : m.browserbase ? "browserbase" : null;
  const provider = m.providers[0] ?? null;
  if (browser && provider) {
    const env = browser === "browserbase" ? " -e browserbase" : "";
    return {
      plan: {
        kind: "real",
        browser,
        provider,
        reason: `${providerLabel(provider)} key + ${browser === "local" ? "local Chrome" : "Browserbase"} — real agent runs are unlocked`,
      },
      recommend: {
        command: `run ${FIRST_BENCH_TARGET} -l 3${env}`,
        line: "Run three real WebVoyager cases (a few minutes, a few cents).",
      },
    };
  }
  const missing: string[] = [];
  if (!provider)
    missing.push(
      "a provider key (OPENAI_API_KEY, ANTHROPIC_API_KEY or GOOGLE_GENERATIVE_AI_API_KEY)",
    );
  if (!browser)
    missing.push("a browser (local Chrome, or BROWSERBASE_API_KEY + BROWSERBASE_PROJECT_ID)");
  return {
    plan: {
      kind: "scripted",
      reason: `missing ${missing.join(" and ")} — replaying a recorded-style run`,
    },
    recommend: {
      command: "list bench",
      line: `Add ${missing.join(" and ")} to packages/evals/.env to run real agent benchmarks.`,
    },
  };
}

export function providerLabel(p: Provider): string {
  return p === "openai" ? "OpenAI" : p === "anthropic" ? "Anthropic" : "Google";
}

/** Short label for machine-check rows. */
export function chromeLabel(m: Machine): string {
  if (!m.chrome) return "not found";
  return m.chrome.includes("Chromium") ? "Chromium found" : "Chrome found";
}

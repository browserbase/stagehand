/**
 * Environment snapshot + inline warning rendering.
 *
 * Used by:
 *   - the one-time first-run welcome panel (`welcome.ts`)
 *   - `evals doctor`
 *   - the REPL's zero-keys inline warning (only inline output about env state)
 *
 * The single canonical view of which API keys are present, with source
 * provenance for the doctor's JSON output. The renderInlineWarning function
 * is intentionally narrow — it returns non-null ONLY when zero provider keys
 * are present, so the daily REPL stays quiet. Adding more inline cases here
 * is a deliberate policy change, not a code edit.
 */

import { cyan, dim, yellow } from "./format.js";
import { getEvalsEnvReport } from "../evalsEnv.js";

export type KeyState = "set" | "missing";
export type KeySource = "process-env" | "package-dotenv" | "cwd-dotenv" | "none";

export type ProviderKeyEntry = {
  state: KeyState;
  source: KeySource;
};

export type GoogleKeyEntry = ProviderKeyEntry & {
  /** Which env var actually held the value, or null if missing. */
  var: "GOOGLE_GENERATIVE_AI_API_KEY" | "GEMINI_API_KEY" | null;
};

export type LangSmithKeyEntry = ProviderKeyEntry & {
  /** Which env var actually held the value, or null if missing. */
  var: "LANGSMITH_API_KEY" | "LANGCHAIN_API_KEY" | null;
};

export type BrowserbaseKeyEntry = {
  apiKey: KeyState;
  projectId: KeyState;
  /** True if only the BB_* alias variants are present (not the canonical names). */
  viaAlias: boolean;
};

export type EnvSnapshot = {
  openai: ProviderKeyEntry;
  anthropic: ProviderKeyEntry;
  google: GoogleKeyEntry;
  browserbase: BrowserbaseKeyEntry;
  braintrust: ProviderKeyEntry;
  langsmith: LangSmithKeyEntry;
};

/**
 * Resolve a single env var from process.env, which `loadEvalsEnv()` has
 * already filled from the .env files at the CLI entry — so this sees exactly
 * what the runner sees. The source says which file supplied the key, or
 * `process-env` for a shell export / CI secret.
 *
 * Exported so callers that need the actual value (e.g. the doctor's
 * `--probe` flag) can use the same resolution as `snapshotEnv()`. The
 * snapshot itself intentionally exposes only `state` + `source`, not the
 * value — exposing raw key material via the doctor JSON would be a leak.
 */
export function resolveKey(name: string): { value: string; source: KeySource } {
  const fromProcess = process.env[name];
  if (fromProcess && fromProcess.length > 0) {
    // When loadEvalsEnv() ran (the CLI entry), it knows which file put the
    // key there; anything else was a shell export / CI secret.
    const fileKind = getEvalsEnvReport()?.sources.get(name);
    const source: KeySource =
      fileKind === "package" ? "package-dotenv" : fileKind === "cwd" ? "cwd-dotenv" : "process-env";
    return { value: fromProcess, source };
  }
  return { value: "", source: "none" };
}

function providerEntry(name: string): ProviderKeyEntry {
  const r = resolveKey(name);
  return {
    state: r.value ? "set" : "missing",
    source: r.source,
  };
}

function langSmithEntry(): LangSmithKeyEntry {
  const primary = providerEntry("LANGSMITH_API_KEY");
  if (primary.state === "set") return { ...primary, var: "LANGSMITH_API_KEY" };
  const fallback = providerEntry("LANGCHAIN_API_KEY");
  return {
    ...fallback,
    var: fallback.state === "set" ? "LANGCHAIN_API_KEY" : null,
  };
}

function googleEntry(): GoogleKeyEntry {
  // Prefer the canonical GOOGLE_GENERATIVE_AI_API_KEY name; fall back to GEMINI_API_KEY.
  const a = resolveKey("GOOGLE_GENERATIVE_AI_API_KEY");
  if (a.value) {
    return {
      state: "set",
      source: a.source,
      var: "GOOGLE_GENERATIVE_AI_API_KEY",
    };
  }
  const b = resolveKey("GEMINI_API_KEY");
  if (b.value) {
    return { state: "set", source: b.source, var: "GEMINI_API_KEY" };
  }
  return { state: "missing", source: "none", var: null };
}

function browserbaseEntry(): BrowserbaseKeyEntry {
  const canonApi = resolveKey("BROWSERBASE_API_KEY");
  const canonProj = resolveKey("BROWSERBASE_PROJECT_ID");
  const aliasApi = resolveKey("BB_API_KEY");
  const aliasProj = resolveKey("BB_PROJECT_ID");

  const canonApiPresent = canonApi.value.length > 0;
  const aliasApiPresent = aliasApi.value.length > 0;
  const canonProjPresent = canonProj.value.length > 0;
  const aliasProjPresent = aliasProj.value.length > 0;

  const apiSet = canonApiPresent || aliasApiPresent;
  const projSet = canonProjPresent || aliasProjPresent;

  // `viaAlias` is true iff at least one BB var is present AND every present
  // BB var was resolved only via its BB_* alias (no canonical name won).
  // Drives the dim "(via BB_API_KEY)" note in the doctor — if the user set
  // the canonical name for one and the alias for the other, the note would
  // be misleading, so we suppress it.
  const apiAbsent = !apiSet;
  const projAbsent = !projSet;
  const apiOnlyAlias = aliasApiPresent && !canonApiPresent;
  const projOnlyAlias = aliasProjPresent && !canonProjPresent;
  const anyPresent = !apiAbsent || !projAbsent;
  const allPresentAreAlias = (apiAbsent || apiOnlyAlias) && (projAbsent || projOnlyAlias);
  const viaAlias = anyPresent && allPresentAreAlias;

  return {
    apiKey: apiSet ? "set" : "missing",
    projectId: projSet ? "set" : "missing",
    viaAlias,
  };
}

/**
 * Snapshot of which keys are set, from process.env (see resolveKey).
 * Pure; safe to call repeatedly.
 */
export function snapshotEnv(): EnvSnapshot {
  return {
    openai: providerEntry("OPENAI_API_KEY"),
    anthropic: providerEntry("ANTHROPIC_API_KEY"),
    google: googleEntry(),
    browserbase: browserbaseEntry(),
    braintrust: providerEntry("BRAINTRUST_API_KEY"),
    langsmith: langSmithEntry(),
  };
}

// ---------------------------------------------------------------------------
// Inline warning rendering.
// Returns the warning string iff zero provider keys are present. Otherwise
// null — meaning "do not print anything inline about env state."
// ---------------------------------------------------------------------------

export function hasZeroProviderKeys(s: EnvSnapshot): boolean {
  return (
    s.openai.state === "missing" && s.anthropic.state === "missing" && s.google.state === "missing"
  );
}

export function renderInlineWarning(s: EnvSnapshot): string | null {
  if (!hasZeroProviderKeys(s)) return null;
  return `  ${yellow("⚠ No provider API key found.")} ${dim("Run")} ${cyan("evals doctor")} ${dim("for setup help.")}`;
}

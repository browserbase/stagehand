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

import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { cyan, dim, yellow } from "./format.js";
import { getPackageRootDir } from "../runtimePaths.js";

export type KeyState = "set" | "missing";
export type KeySource = "process-env" | "package-dotenv" | "none";

export type ProviderKeyEntry = {
  state: KeyState;
  source: KeySource;
};

export type GoogleKeyEntry = ProviderKeyEntry & {
  /** Which env var actually held the value, or null if missing. */
  var: "GOOGLE_GENERATIVE_AI_API_KEY" | "GEMINI_API_KEY" | null;
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
};

// ---------------------------------------------------------------------------
// Package-dotenv loader (one-shot, cached for the process lifetime).
// Mirrors the pattern in lib/braintrust-report.ts:365-373 — read
// packages/evals/.env so users running `pnpm evals` from the repo root
// (cwd ≠ packages/evals) still see their package-local keys.
// ---------------------------------------------------------------------------

let cachedPackageEnv: Record<string, string> | null = null;
let packageEnvLoaded = false;

function loadPackageEnv(): Record<string, string> {
  // Test escape hatch: set EVALS_DISABLE_PACKAGE_ENV=1 to skip reading the
  // package-local .env file. Lives in process.env (not a module-scoped
  // variable) so it works regardless of how the welcomeStatus module is
  // resolved by the test runner.
  if (process.env.EVALS_DISABLE_PACKAGE_ENV === "1") return {};
  if (packageEnvLoaded) return cachedPackageEnv ?? {};
  packageEnvLoaded = true;
  try {
    const envPath = path.join(getPackageRootDir(), ".env");
    const raw = fs.readFileSync(envPath, "utf-8");
    cachedPackageEnv = dotenv.parse(raw);
  } catch {
    cachedPackageEnv = null;
  }
  return cachedPackageEnv ?? {};
}

/**
 * Resolve a single env var, checking process.env first then the package .env.
 * Returns the value + which source it came from.
 */
function resolve(name: string): { value: string; source: KeySource } {
  const fromProcess = process.env[name];
  if (fromProcess && fromProcess.length > 0) {
    return { value: fromProcess, source: "process-env" };
  }
  const fromPackage = loadPackageEnv()[name];
  if (fromPackage && fromPackage.length > 0) {
    return { value: fromPackage, source: "package-dotenv" };
  }
  return { value: "", source: "none" };
}

function providerEntry(name: string): ProviderKeyEntry {
  const r = resolve(name);
  return {
    state: r.value ? "set" : "missing",
    source: r.source,
  };
}

function googleEntry(): GoogleKeyEntry {
  // Prefer the canonical GOOGLE_GENERATIVE_AI_API_KEY name; fall back to GEMINI_API_KEY.
  const a = resolve("GOOGLE_GENERATIVE_AI_API_KEY");
  if (a.value) {
    return {
      state: "set",
      source: a.source,
      var: "GOOGLE_GENERATIVE_AI_API_KEY",
    };
  }
  const b = resolve("GEMINI_API_KEY");
  if (b.value) {
    return { state: "set", source: b.source, var: "GEMINI_API_KEY" };
  }
  return { state: "missing", source: "none", var: null };
}

function browserbaseEntry(): BrowserbaseKeyEntry {
  const canonApi = resolve("BROWSERBASE_API_KEY");
  const canonProj = resolve("BROWSERBASE_PROJECT_ID");
  const aliasApi = resolve("BB_API_KEY");
  const aliasProj = resolve("BB_PROJECT_ID");

  const apiSet = canonApi.value.length > 0 || aliasApi.value.length > 0;
  const projSet = canonProj.value.length > 0 || aliasProj.value.length > 0;

  // viaAlias is true only when ALL present BB values come from the alias names.
  const viaAlias =
    (apiSet && !canonApi.value && !!aliasApi.value) ||
    (projSet && !canonProj.value && !!aliasProj.value);

  return {
    apiKey: apiSet ? "set" : "missing",
    projectId: projSet ? "set" : "missing",
    viaAlias,
  };
}

/**
 * Read process.env + packages/evals/.env into a single snapshot.
 * Pure modulo the cached dotenv read; safe to call repeatedly.
 */
export function snapshotEnv(): EnvSnapshot {
  return {
    openai: providerEntry("OPENAI_API_KEY"),
    anthropic: providerEntry("ANTHROPIC_API_KEY"),
    google: googleEntry(),
    browserbase: browserbaseEntry(),
    braintrust: providerEntry("BRAINTRUST_API_KEY"),
  };
}

// ---------------------------------------------------------------------------
// Inline warning rendering.
// Returns the warning string iff zero provider keys are present. Otherwise
// null — meaning "do not print anything inline about env state."
// ---------------------------------------------------------------------------

export function hasZeroProviderKeys(s: EnvSnapshot): boolean {
  return (
    s.openai.state === "missing" &&
    s.anthropic.state === "missing" &&
    s.google.state === "missing"
  );
}

export function renderInlineWarning(s: EnvSnapshot): string | null {
  if (!hasZeroProviderKeys(s)) return null;
  return `  ${yellow("⚠ No provider API key found.")} ${dim("Run")} ${cyan("evals doctor")} ${dim("for setup help.")}`;
}

/**
 * Internal helper exported for tests so the cached dotenv can be reset.
 */
export function __resetPackageEnvCacheForTests(): void {
  cachedPackageEnv = null;
  packageEnvLoaded = false;
}

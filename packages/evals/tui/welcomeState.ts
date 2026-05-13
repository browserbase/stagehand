/**
 * First-run welcome state.
 *
 * The marker (`_meta.firstRunCompletedAt`) lives inside `evals.config.json`
 * so it follows the same per-mode (source vs. dist) storage rules as the
 * rest of the config. This is intentional: a contributor switching between
 * `pnpm evals` and a globally installed CLI sees the welcome again — that's
 * acceptable and avoids a separate cross-install state location.
 *
 * `scripts/build-cli.ts` preserves `_meta` across rebuilds so the dist
 * config inherits the source marker on first build.
 */

import {
  readConfig,
  writeConfig,
  type WelcomeMeta,
} from "./commands/config.js";

export const CURRENT_SCHEMA_VERSION = 1;

export function readWelcomeMeta(entryDir: string): WelcomeMeta {
  try {
    const config = readConfig(entryDir);
    return config._meta ?? {};
  } catch {
    // Missing/invalid config → treat as no marker. Reading is best-effort
    // here; the actual handlers surface read errors when they need to.
    return {};
  }
}

export function isFirstRun(entryDir: string): boolean {
  const meta = readWelcomeMeta(entryDir);
  return !meta.firstRunCompletedAt;
}

/**
 * Mark the first-run welcome as completed. Idempotent: re-runs don't change
 * the stored timestamp once set (avoids churn on every launch).
 */
export function markFirstRunComplete(entryDir: string): void {
  try {
    const config = readConfig(entryDir);
    if (config._meta?.firstRunCompletedAt) return;
    config._meta = {
      ...(config._meta ?? {}),
      firstRunCompletedAt: new Date().toISOString(),
      version: CURRENT_SCHEMA_VERSION,
    };
    writeConfig(entryDir, config);
  } catch {
    // Best-effort. The welcome panel still rendered; failing to persist the
    // marker just means the next launch will show it again.
  }
}

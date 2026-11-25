import { readConfig, writeConfig, type WelcomeMeta } from "./commands/config.js";

export const CURRENT_SCHEMA_VERSION = 1;

export function readWelcomeMeta(entryDir: string): WelcomeMeta {
  try {
    const config = readConfig(entryDir);
    return config._meta ?? {};
  } catch {
    return {};
  }
}

export function isFirstRun(entryDir: string): boolean {
  const meta = readWelcomeMeta(entryDir);
  return !meta.firstRunCompletedAt;
}

export function markFirstRunComplete(entryDir: string): void {
  try {
    const config = readConfig(entryDir);
    if (config._meta?.firstRunCompletedAt) return;
    config._meta = {
      ...config._meta,
      firstRunCompletedAt: new Date().toISOString(),
      version: CURRENT_SCHEMA_VERSION,
    };
    writeConfig(entryDir, config);
  } catch {}
}

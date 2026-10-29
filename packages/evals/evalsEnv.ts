/**
 * The one place the evals CLI loads `.env` files.
 *
 * Before this, `cli.ts` ran `dotenv.config()` (cwd/.env only) while the doctor
 * parsed `packages/evals/.env` without merging it — so `evals doctor` from the
 * repo root could report a key "set (package-dotenv)" that the runner never
 * loaded, and a root `.env` was invisible from `packages/evals`.
 *
 * Order: `<cwd>/.env` first (it wins), then `packages/evals/.env` when it is a
 * different file — so a repo-root launch still sees the keys `evals setup`
 * saves in the package file. An existing `process.env` value is never
 * overridden (shell exports and CI secrets win, like `dotenv.config()`), and
 * the loader records which file supplied each key plus which keys a file *would* have set but
 * couldn't — reported by name only, never by value.
 */

import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { getPackageRootDir } from "./runtimePaths.js";

export type EnvFileKind = "package" | "cwd";

export interface EnvFileReport {
  kind: EnvFileKind;
  path: string;
  /** File existed and parsed. */
  loaded: boolean;
  /** Keys this file put into process.env. */
  applied: string[];
}

export interface ShadowedKey {
  name: string;
  /** File that carried a different value for the key. */
  file: string;
  /** What won: an existing shell/CI export, or an earlier env file. */
  by: "shell" | EnvFileKind;
}

export interface EvalsEnvReport {
  files: EnvFileReport[];
  /** Key → file kind that supplied it (only keys the loader applied). */
  sources: Map<string, EnvFileKind>;
  shadowed: ShadowedKey[];
}

export interface LoadEvalsEnvOptions {
  cwd?: string;
  packageRoot?: string;
  env?: NodeJS.ProcessEnv;
  /** Force a reload instead of returning the cached report. */
  force?: boolean;
}

let cachedReport: EvalsEnvReport | undefined;

function readEnvFile(filePath: string): Record<string, string> | undefined {
  try {
    return dotenv.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return undefined;
  }
}

/** Candidate files in load order; the package file is skipped under EVALS_DISABLE_PACKAGE_ENV=1. */
export function resolveEnvFiles(
  options: LoadEvalsEnvOptions = {},
): Array<{ kind: EnvFileKind; path: string }> {
  const env = options.env ?? process.env;
  const packagePath = path.join(options.packageRoot ?? getPackageRootDir(), ".env");
  const cwdPath = path.join(options.cwd ?? process.cwd(), ".env");
  const files: Array<{ kind: EnvFileKind; path: string }> = [];
  const samePath = path.resolve(cwdPath) === path.resolve(packagePath);
  if (!samePath) files.push({ kind: "cwd", path: cwdPath });
  if (env.EVALS_DISABLE_PACKAGE_ENV !== "1") files.push({ kind: "package", path: packagePath });
  return files;
}

/**
 * Load env files into `process.env` (or `options.env`) once per process and
 * return the provenance report. Safe to call repeatedly.
 */
export function loadEvalsEnv(options: LoadEvalsEnvOptions = {}): EvalsEnvReport {
  if (cachedReport && !options.force) return cachedReport;
  const env = options.env ?? process.env;
  const report: EvalsEnvReport = { files: [], sources: new Map(), shadowed: [] };

  for (const file of resolveEnvFiles(options)) {
    const parsed = readEnvFile(file.path);
    const fileReport: EnvFileReport = { ...file, loaded: parsed !== undefined, applied: [] };
    report.files.push(fileReport);
    if (!parsed) continue;
    for (const [name, value] of Object.entries(parsed)) {
      const existing = env[name];
      if (existing === undefined) {
        env[name] = value;
        fileReport.applied.push(name);
        report.sources.set(name, file.kind);
        continue;
      }
      if (existing !== value) {
        report.shadowed.push({ name, file: file.path, by: report.sources.get(name) ?? "shell" });
      }
    }
  }

  cachedReport = report;
  return report;
}

/** The report from the most recent load, if any. */
export function getEvalsEnvReport(): EvalsEnvReport | undefined {
  return cachedReport;
}

export function __resetEvalsEnvForTests(): void {
  cachedReport = undefined;
}

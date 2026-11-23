import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { getPackageRootDir } from "./runtimePaths.js";

export type EnvFileKind = "package" | "cwd";

export interface EnvFileReport {
  kind: EnvFileKind;
  path: string;
  loaded: boolean;
  applied: string[];
}

export interface ShadowedKey {
  name: string;
  file: string;
  by: "shell" | EnvFileKind;
}

export interface EvalsEnvReport {
  files: EnvFileReport[];
  sources: Map<string, EnvFileKind>;
  shadowed: ShadowedKey[];
}

export interface LoadEvalsEnvOptions {
  cwd?: string;
  packageRoot?: string;
  env?: NodeJS.ProcessEnv;
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

export function getEvalsEnvReport(): EvalsEnvReport | undefined {
  return cachedReport;
}

export function __resetEvalsEnvForTests(): void {
  cachedReport = undefined;
}

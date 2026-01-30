/**
 * Shared helpers for scripts (not a runnable script).
 *
 * Prereqs: none.
 * Args: n/a.
 * Env: n/a.
 * Example: import { findRepoRoot } from "./test-utils";
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

export const findRepoRoot = (startDir: string): string => {
  let current = path.resolve(startDir);
  while (true) {
    if (fs.existsSync(path.join(current, "pnpm-workspace.yaml"))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) return startDir;
    current = parent;
  }
};

export const resolveFromRoot = (repoRoot: string, value: string) =>
  path.isAbsolute(value) ? value : path.resolve(repoRoot, value);

export const ensureParentDir = (filePath: string) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
};

export const splitArgs = (args: string[]) => {
  const separatorIndex = args.indexOf("--");
  return {
    paths: separatorIndex === -1 ? args : args.slice(0, separatorIndex),
    extra: separatorIndex === -1 ? [] : args.slice(separatorIndex + 1),
  };
};

export const parseListFlag = (args: string[]) => {
  const remaining: string[] = [];
  let value: string | null = null;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--list") {
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        value = next;
        i += 1;
      } else {
        value = "";
      }
      continue;
    }
    if (arg.startsWith("--list=")) {
      value = arg.slice("--list=".length);
      continue;
    }
    remaining.push(arg);
  }
  return { list: value !== null, value: value ?? "", args: remaining };
};

export const toSafeName = (name: string) => name.replace(/[\\/]/g, "-");

export const collectFiles = (dir: string, suffix: string) => {
  const results: string[] = [];
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith(suffix)) {
        results.push(full);
      }
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return results.sort();
};

export const normalizeVitestArgs = (repoRoot: string, argsList: string[]) => {
  const normalized = [...argsList];
  const prefix = "--outputFile.junit=";
  for (let i = 0; i < normalized.length; i++) {
    const arg = normalized[i];
    if (arg.startsWith(prefix)) {
      const value = arg.slice(prefix.length);
      const resolved = resolveFromRoot(repoRoot, value);
      ensureParentDir(resolved);
      normalized[i] = `${prefix}${resolved}`;
      continue;
    }
    if (arg === "--outputFile.junit" && normalized[i + 1]) {
      const resolved = resolveFromRoot(repoRoot, normalized[i + 1]);
      ensureParentDir(resolved);
      normalized[i + 1] = resolved;
      i += 1;
    }
  }
  return normalized;
};

export const findJunitPath = (argsList: string[]) => {
  const prefix = "--outputFile.junit=";
  for (let i = 0; i < argsList.length; i++) {
    const arg = argsList[i];
    if (arg.startsWith(prefix)) {
      return arg.slice(prefix.length);
    }
    if (arg === "--outputFile.junit" && argsList[i + 1]) {
      return argsList[i + 1];
    }
  }
  return null;
};

export const hasReporter = (argsList: string[]) =>
  argsList.some((arg) => arg === "--reporter" || arg.startsWith("--reporter="));

export const hasJunitReporter = (argsList: string[]) =>
  argsList.some((arg) => arg === "--reporter=junit");

export const writeCtrfFromJunit = (junitPath: string, tool: string) => {
  if (!fs.existsSync(junitPath)) return;
  const stat = fs.statSync(junitPath);
  if (stat.size === 0) return;
  const repoRoot = findRepoRoot(process.cwd());
  const ctrfPath = junitPath.match(/\.xml$/i)
    ? junitPath.replace(/\.xml$/i, ".json")
    : `${junitPath}.json`;
  const result = spawnSync(
    "pnpm",
    ["exec", "junit-to-ctrf", junitPath, "-o", ctrfPath, "-t", tool],
    { stdio: "inherit", cwd: repoRoot },
  );
  if (result.status !== 0) {
    console.warn(`CTRF conversion failed for ${junitPath}.`);
  }
};

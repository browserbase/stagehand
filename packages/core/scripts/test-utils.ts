/**
 * Shared helpers for scripts (not a runnable script).
 *
 * Prereqs: none.
 * Args: n/a.
 * Env: n/a.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { getRepoRootDir } from "../lib/v3/runtimePaths.js";

const workspaceRoot = getRepoRootDir();

export const ensureParentDir = (filePath: string) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
};

export const splitArgs = (args: string[]) => {
  const tokens = [...args];
  while (tokens[0] === "--") {
    tokens.shift();
  }

  const leadingExtra: string[] = [];
  while (tokens.length > 0 && tokens[0].startsWith("-")) {
    const arg = tokens.shift();
    if (!arg) break;
    if (arg === "--") break;
    leadingExtra.push(arg);
    if (
      !arg.includes("=") &&
      tokens[0] &&
      tokens[0] !== "--" &&
      !tokens[0].startsWith("-")
    ) {
      leadingExtra.push(tokens.shift() as string);
    }
  }

  while (tokens[0] === "--") {
    tokens.shift();
  }

  const separatorIndex = tokens.indexOf("--");
  return {
    paths: separatorIndex === -1 ? tokens : tokens.slice(0, separatorIndex),
    extra: [
      ...leadingExtra,
      ...(separatorIndex === -1 ? [] : tokens.slice(separatorIndex + 1)),
    ],
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
      const full = `${current}/${entry.name}`;
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
      const resolved = path.isAbsolute(value)
        ? value
        : path.resolve(repoRoot, value);
      ensureParentDir(resolved);
      normalized[i] = `${prefix}${resolved}`;
      continue;
    }
    if (arg === "--outputFile.junit" && normalized[i + 1]) {
      const resolved = path.isAbsolute(normalized[i + 1])
        ? normalized[i + 1]
        : path.resolve(repoRoot, normalized[i + 1]);
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

const parseReporters = (argsList: string[]) => {
  const reporters: string[] = [];
  for (let i = 0; i < argsList.length; i++) {
    const arg = argsList[i];
    if (arg.startsWith("--reporter=")) {
      reporters.push(arg.slice("--reporter=".length));
      continue;
    }
    if (arg === "--reporter" && argsList[i + 1]) {
      reporters.push(argsList[i + 1]);
      i += 1;
    }
  }
  return reporters
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);
};

export const hasReporterName = (argsList: string[], reporter: string) =>
  parseReporters(argsList).some((value) => value === reporter);

export const writeCtrfFromJunit = (junitPath: string, tool: string) => {
  if (!fs.existsSync(junitPath)) return;
  const stat = fs.statSync(junitPath);
  if (stat.size === 0) return;
  const ctrfPath = junitPath.match(/\.xml$/i)
    ? junitPath.replace(/\.xml$/i, ".json")
    : `${junitPath}.json`;
  const result = spawnSync(
    "pnpm",
    ["exec", "junit-to-ctrf", junitPath, "-o", ctrfPath, "-t", tool],
    { stdio: "inherit", cwd: workspaceRoot },
  );
  if (result.status !== 0) {
    console.warn(`CTRF conversion failed for ${junitPath}.`);
  }
};

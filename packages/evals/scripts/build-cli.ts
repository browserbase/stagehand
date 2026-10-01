/**
 * Build the evals CLI (packages/evals/dist/cli/cli.js + config), including a node shebang.
 *
 * Prereqs: pnpm install.
 * Args: none.
 * Env: none.
 * Example: pnpm run build:cli
 */
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { getRepoRootDir } from "../runtimePaths.js";

const repoRoot = getRepoRootDir();

const run = (args: string[]) => {
  const result = spawnSync("pnpm", args, { stdio: "inherit", cwd: repoRoot });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
};

fs.mkdirSync(`${repoRoot}/packages/evals/dist/cli`, { recursive: true });

run([
  "exec",
  "esbuild",
  "packages/evals/cli.ts",
  "--bundle",
  "--platform=node",
  "--format=esm",
  `--outfile=${repoRoot}/packages/evals/dist/cli/cli.js`,
  "--sourcemap",
  "--packages=external",
  "--banner:js=#!/usr/bin/env node",
  "--log-level=warning",
]);

/* ── config: seed the tracked file verbatim. Personal overrides and the
   first-run marker live in dist/cli/evals.config.local.json, which the CLI
   writes and this script never touches — so nothing needs merging.

   One-time migration: a pre-v2 dist config carried user edits (defaults,
   core, tracing, _meta) inline. If no local file exists yet, move whatever
   differs from the source into the local file so a rebuild does not reset
   concurrency or re-show the welcome. ── */
// The v1 tracked defaults. Old builds copied them into the dist config, so a
// value equal to one of them is not a personal edit and must not be pinned
// over the new tracked default (v2 lowers concurrency from 10 to 3).
const PREVIOUS_TRACKED_DEFAULTS: Record<string, unknown> = {
  env: "local",
  trials: 3,
  concurrency: 10,
  model: null,
  api: false,
  verbose: false,
};
const sourceConfig = JSON.parse(
  fs.readFileSync(`${repoRoot}/packages/evals/evals.config.json`, "utf-8"),
);
const distConfigPath = `${repoRoot}/packages/evals/dist/cli/evals.config.json`;
const distLocalConfigPath = `${repoRoot}/packages/evals/dist/cli/evals.config.local.json`;

if (fs.existsSync(distConfigPath) && !fs.existsSync(distLocalConfigPath)) {
  try {
    const existing = JSON.parse(fs.readFileSync(distConfigPath, "utf-8")) as Record<
      string,
      Record<string, unknown> | undefined
    >;
    const local: Record<string, Record<string, unknown>> = {};
    for (const section of ["defaults", "core", "tracing", "_meta"]) {
      const before = existing[section];
      if (!before || typeof before !== "object") continue;
      const source = (sourceConfig[section] ?? {}) as Record<string, unknown>;
      const diff: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(before)) {
        if (section === "defaults" && key === "provider") continue; // never read
        if (JSON.stringify(source[key]) === JSON.stringify(value)) continue;
        if (
          section === "defaults" &&
          key in PREVIOUS_TRACKED_DEFAULTS &&
          JSON.stringify(PREVIOUS_TRACKED_DEFAULTS[key]) === JSON.stringify(value)
        ) {
          continue;
        }
        diff[key] = value;
      }
      if (Object.keys(diff).length > 0) local[section] = diff;
    }
    if (Object.keys(local).length > 0) {
      fs.writeFileSync(distLocalConfigPath, JSON.stringify(local, null, 2) + "\n");
    }
  } catch {
    // invalid existing config – nothing worth migrating
  }
}

fs.writeFileSync(distConfigPath, JSON.stringify(sourceConfig, null, 2) + "\n");
fs.writeFileSync(`${repoRoot}/packages/evals/dist/cli/package.json`, '{\n  "type": "module"\n}\n');
fs.chmodSync(`${repoRoot}/packages/evals/dist/cli/cli.js`, 0o755);

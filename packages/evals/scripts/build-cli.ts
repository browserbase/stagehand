/**
 * Build the evals CLI (packages/evals/dist/cli/cli.js + config), including a node shebang.
 *
 * Prereqs: pnpm install.
 * Args: none.
 * Env: none.
 * Example: pnpm run build:cli
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { findRepoRoot } from "../../core/scripts/test-utils";

const repoRoot = findRepoRoot(process.cwd());
const evalsRoot = path.join(repoRoot, "packages", "evals");
const distDir = path.join(evalsRoot, "dist", "cli");
const cliOutfile = path.join(distDir, "cli.js");

const run = (args: string[]) => {
  const result = spawnSync("pnpm", args, { stdio: "inherit", cwd: repoRoot });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
};

fs.mkdirSync(distDir, { recursive: true });

run([
  "exec",
  "esbuild",
  "packages/evals/cli.ts",
  "--bundle",
  "--platform=node",
  "--format=esm",
  `--outfile=${cliOutfile}`,
  "--sourcemap",
  "--packages=external",
  "--banner:js=#!/usr/bin/env node",
  "--log-level=warning",
]);

fs.copyFileSync(
  path.join(evalsRoot, "evals.config.json"),
  path.join(distDir, "evals.config.json"),
);
fs.writeFileSync(
  path.join(distDir, "package.json"),
  '{\n  "type": "module"\n}\n',
);
fs.chmodSync(cliOutfile, 0o755);

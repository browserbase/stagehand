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

fs.copyFileSync(
  `${repoRoot}/packages/evals/evals.config.json`,
  `${repoRoot}/packages/evals/dist/cli/evals.config.json`,
);
fs.writeFileSync(
  `${repoRoot}/packages/evals/dist/cli/package.json`,
  '{\n  "type": "module"\n}\n',
);
fs.chmodSync(`${repoRoot}/packages/evals/dist/cli/cli.js`, 0o755);

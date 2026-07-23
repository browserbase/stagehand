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

/* ── merge config: always update tasks/benchmarks from source, but preserve user defaults ── */
const sourceConfig = JSON.parse(
  fs.readFileSync(`${repoRoot}/packages/evals/evals.config.json`, "utf-8"),
);
const distConfigPath = `${repoRoot}/packages/evals/dist/cli/evals.config.json`;

if (fs.existsSync(distConfigPath)) {
  try {
    const existing = JSON.parse(fs.readFileSync(distConfigPath, "utf-8"));
    if (existing.defaults) {
      sourceConfig.defaults = {
        ...sourceConfig.defaults,
        ...existing.defaults,
      };
    }
    // Preserve the first-run welcome marker across rebuilds so a contributor
    // who's already seen the welcome on the dist path doesn't see it again
    // after every `pnpm run build:cli`. If the source has _meta and dist
    // doesn't (fresh dist install), the source value is inherited via the
    // sourceConfig literal — already correct.
    if (existing._meta) {
      sourceConfig._meta = { ...sourceConfig._meta, ...existing._meta };
    }
  } catch {
    // invalid existing config – overwrite entirely
  }
}

fs.writeFileSync(distConfigPath, JSON.stringify(sourceConfig, null, 2) + "\n");
fs.writeFileSync(
  `${repoRoot}/packages/evals/dist/cli/package.json`,
  '{\n  "type": "module"\n}\n',
);
fs.chmodSync(`${repoRoot}/packages/evals/dist/cli/cli.js`, 0o755);

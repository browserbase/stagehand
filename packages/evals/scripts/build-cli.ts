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

import esbuild from "esbuild";

const run = (args: string[]) => {
  const cmd = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const result = spawnSync(cmd, args, {
    stdio: "inherit",
    cwd: repoRoot,
  });
  if (result.error) {
    console.error("Spawn error:", result.error);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
};

fs.mkdirSync(`${repoRoot}/packages/evals/dist/cli`, { recursive: true });

esbuild.buildSync({
  entryPoints: [`${repoRoot}/packages/evals/cli.ts`],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: `${repoRoot}/packages/evals/dist/cli/cli.js`,
  sourcemap: true,
  packages: "external",
  banner: { js: "#!/usr/bin/env node" },
  logLevel: "warning",
  absWorkingDir: repoRoot,
});

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

/* ── auto-link the `evals` binary globally ── */
const link = spawnSync("npm", ["link", "--force"], {
  stdio: "inherit",
  cwd: `${repoRoot}/packages/evals`,
  shell: process.platform === "win32",
});
if (link.status !== 0) {
  console.warn(
    "⚠  npm link failed (non-fatal) – you can run `npm link` manually from packages/evals",
  );
}

/**
 * Build canonical dist/cjs output for the agent package.
 *
 * Prereqs: pnpm install.
 * Args: none.
 * Env: none.
 * Example: pnpm run build:cjs
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const repoRoot = path.resolve(packageRoot, "..", "..");

const run = (args: string[]) => {
  const result = spawnSync("pnpm", args, {
    cwd: repoRoot,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
};

fs.rmSync(`${packageRoot}/dist/cjs`, {
  recursive: true,
  force: true,
});
fs.mkdirSync(`${packageRoot}/dist/cjs`, { recursive: true });

run([
  "exec",
  "esbuild",
  "packages/agent/index.ts",
  "packages/agent/lib/protocol.ts",
  "--bundle",
  "--platform=node",
  "--format=cjs",
  "--packages=external",
  "--outbase=packages/agent",
  "--outdir=packages/agent/dist/cjs",
  "--log-level=warning",
]);

fs.writeFileSync(
  `${packageRoot}/dist/cjs/package.json`,
  '{\n  "type": "commonjs"\n}\n',
);

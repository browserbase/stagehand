/**
 * Build canonical dist/esm output for the agent package.
 *
 * Prereqs: pnpm install.
 * Args: none.
 * Env: none.
 * Example: pnpm run build:esm
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

fs.rmSync(`${packageRoot}/dist/esm`, {
  recursive: true,
  force: true,
});

run(["exec", "tsc", "-p", "packages/agent/tsconfig.json"]);

fs.mkdirSync(`${packageRoot}/dist/esm`, { recursive: true });
fs.writeFileSync(
  `${packageRoot}/dist/esm/package.json`,
  '{\n  "type": "module"\n}\n',
);

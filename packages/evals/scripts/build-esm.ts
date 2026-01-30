/**
 * Build canonical dist/esm output for evals (plus assets/config).
 *
 * Prereqs: pnpm install.
 * Args: none.
 * Env: none.
 * Example: pnpm run build:esm
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { findRepoRoot } from "../../core/scripts/test-utils";

const repoRoot = findRepoRoot(process.cwd());
const evalsRoot = path.join(repoRoot, "packages", "evals");
const evalsDist = path.join(evalsRoot, "dist", "esm");

const run = (args: string[]) => {
  const result = spawnSync("pnpm", args, { stdio: "inherit", cwd: repoRoot });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
};

fs.rmSync(evalsDist, { recursive: true, force: true });
// Evals run from dist/esm JS, but still need config/assets/datasets on disk.
run(["exec", "tsc", "-p", "packages/evals/tsconfig.json"]);

fs.mkdirSync(evalsDist, { recursive: true });
fs.writeFileSync(
  path.join(evalsDist, "package.json"),
  '{\n  "type": "module"\n}\n',
);

const copyFile = (filename: string) => {
  const src = path.join(evalsRoot, filename);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, path.join(evalsDist, filename));
  }
};

const copyDir = (dirname: string) => {
  const srcDir = path.join(evalsRoot, dirname);
  if (fs.existsSync(srcDir)) {
    fs.cpSync(srcDir, path.join(evalsDist, dirname), { recursive: true });
  }
};

copyFile("evals.config.json");
copyDir("datasets");
copyDir("assets");

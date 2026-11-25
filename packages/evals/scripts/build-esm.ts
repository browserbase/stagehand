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

fs.rmSync(`${repoRoot}/packages/evals/dist/esm`, {
  recursive: true,
  force: true,
});
run(["exec", "tsc", "-p", "packages/evals/tsconfig.build.json"]);

fs.mkdirSync(`${repoRoot}/packages/evals/dist/esm`, { recursive: true });
fs.writeFileSync(`${repoRoot}/packages/evals/dist/esm/package.json`, '{\n  "type": "module"\n}\n');

const copyFile = (filename: string) => {
  const src = `${repoRoot}/packages/evals/${filename}`;
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, `${repoRoot}/packages/evals/dist/esm/${filename}`);
  }
};

const copyDir = (dirname: string) => {
  const srcDir = `${repoRoot}/packages/evals/${dirname}`;
  if (fs.existsSync(srcDir)) {
    fs.cpSync(srcDir, `${repoRoot}/packages/evals/dist/esm/${dirname}`, {
      recursive: true,
    });
  }
};

copyFile("evals.config.json");
copyDir("datasets");
copyDir("assets");

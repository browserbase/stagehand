/**
 * Build canonical dist/ (CJS) output for the core package, including types.
 *
 * Prereqs: pnpm install.
 * Args: none.
 * Env: none.
 * Example: pnpm run build:cjs
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { findRepoRoot } from "./test-utils";

const repoRoot = findRepoRoot(process.cwd());
const coreRoot = path.join(repoRoot, "packages", "core");
const distRoot = path.join(coreRoot, "dist");
const cjsDist = path.join(distRoot, "cjs");

const run = (args: string[]) => {
  const result = spawnSync("pnpm", args, { stdio: "inherit", cwd: repoRoot });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
};

fs.rmSync(cjsDist, { recursive: true, force: true });
fs.mkdirSync(cjsDist, { recursive: true });

run([
  "exec",
  "esbuild",
  "packages/core/lib/v3/index.ts",
  "--bundle",
  "--platform=node",
  "--format=cjs",
  "--outfile=packages/core/dist/cjs/index.js",
  "--sourcemap",
  "--packages=external",
  "--log-level=warning",
]);

run([
  "exec",
  "tsc",
  "-p",
  "packages/core/tsconfig.json",
  "--declaration",
  "--emitDeclarationOnly",
  "--outDir",
  "packages/core/dist/cjs",
]);

fs.writeFileSync(
  path.join(cjsDist, "index.d.ts"),
  'export * from "./lib/v3/index";\n',
);
fs.writeFileSync(
  path.join(cjsDist, "package.json"),
  '{\n  "type": "commonjs"\n}\n',
);

const coreBuildSrc = path.join(coreRoot, "lib", "v3", "dom", "build");
const coreBuildDest = path.join(cjsDist, "lib", "v3", "dom", "build");
fs.mkdirSync(coreBuildDest, { recursive: true });
if (fs.existsSync(coreBuildSrc)) {
  for (const file of fs.readdirSync(coreBuildSrc)) {
    if (file.endsWith(".js")) {
      fs.copyFileSync(
        path.join(coreBuildSrc, file),
        path.join(coreBuildDest, file),
      );
    }
  }
}

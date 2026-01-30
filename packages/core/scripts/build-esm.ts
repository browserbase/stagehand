/**
 * Build canonical dist/esm output for the core package (including test JS).
 *
 * Prereqs: pnpm install; run gen-version + build-dom-scripts first (turbo handles).
 * Args: none.
 * Env: none.
 * Example: pnpm run build:esm
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { findRepoRoot } from "./test-utils";

const repoRoot = findRepoRoot(process.cwd());

const run = (args: string[]) => {
  const result = spawnSync("pnpm", args, { stdio: "inherit", cwd: repoRoot });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
};

const coreRoot = path.join(repoRoot, "packages", "core");
const coreDist = path.join(coreRoot, "dist", "esm");
fs.rmSync(coreDist, { recursive: true, force: true });

// Core ESM emit includes generated lib/version.ts from gen-version (run in core build).
run(["exec", "tsc", "-p", "packages/core/tsconfig.json"]);
// Tests run via node/playwright need JS test files; esbuild emits ESM test JS into dist/esm.
run([
  "exec",
  "esbuild",
  "packages/core/tests/**/*.ts",
  "packages/core/lib/v3/tests/**/*.ts",
  "--outdir=packages/core/dist/esm",
  "--outbase=packages/core",
  "--format=esm",
  "--platform=node",
  "--sourcemap",
  "--log-level=warning",
]);

fs.mkdirSync(coreDist, { recursive: true });
fs.writeFileSync(
  path.join(coreDist, "package.json"),
  '{\n  "type": "module"\n}\n',
);
fs.writeFileSync(
  path.join(coreDist, "index.js"),
  [
    'import * as Stagehand from "./lib/v3/index.js";',
    'export * from "./lib/v3/index.js";',
    "export default Stagehand;",
    "",
  ].join("\n"),
);
fs.writeFileSync(
  path.join(coreDist, "index.d.ts"),
  [
    'import * as Stagehand from "./lib/v3/index";',
    'export * from "./lib/v3/index";',
    "export default Stagehand;",
    "",
  ].join("\n"),
);

const coreBuildSrc = path.join(coreRoot, "lib", "v3", "dom", "build");
const coreBuildDest = path.join(coreDist, "lib", "v3", "dom", "build");
fs.mkdirSync(coreBuildDest, { recursive: true });
// DOM script bundles are generated artifacts (not TS emit); copy into dist/esm for runtime.
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

// Note: evals + server test outputs are built by their respective packages.

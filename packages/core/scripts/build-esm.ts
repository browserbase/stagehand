/**
 * Build canonical dist/esm output for the core package (including test JS).
 *
 * Prereqs: pnpm install; run gen-version + build-dom-scripts first (turbo handles).
 * Args: none.
 * Env: none.
 * Example: pnpm run build:esm
 */
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = (() => {
  const value = fileURLToPath(import.meta.url).replaceAll("\\", "/");
  const root = value.split("/packages/core/")[0];
  if (root === value) {
    throw new Error(`Unable to determine repo root from ${value}`);
  }
  return root;
})();

const run = (args: string[]) => {
  const result = spawnSync("pnpm", args, { stdio: "inherit", cwd: repoRoot });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
};

fs.rmSync(`${repoRoot}/packages/core/dist/esm`, {
  recursive: true,
  force: true,
});

// Core ESM emit includes generated lib/version.ts from gen-version (run in core build).
run(["exec", "tsc", "-p", "packages/core/tsconfig.json"]);
// Tests run via node/playwright need JS test files; esbuild emits ESM test JS into dist/esm.
// Unit tests are in tests/unit/, integration tests are in tests/integration/
run([
  "exec",
  "esbuild",
  "packages/core/tests/**/*.ts",
  "--outdir=packages/core/dist/esm",
  "--outbase=packages/core",
  "--format=esm",
  "--platform=node",
  "--sourcemap",
  "--log-level=warning",
]);

fs.mkdirSync(`${repoRoot}/packages/core/dist/esm`, { recursive: true });
fs.writeFileSync(
  `${repoRoot}/packages/core/dist/esm/package.json`,
  '{\n  "type": "module"\n}\n',
);
fs.writeFileSync(
  `${repoRoot}/packages/core/dist/esm/index.js`,
  [
    'import * as Stagehand from "./lib/v3/index.js";',
    'export * from "./lib/v3/index.js";',
    "export default Stagehand;",
    "",
  ].join("\n"),
);
fs.writeFileSync(
  `${repoRoot}/packages/core/dist/esm/index.d.ts`,
  [
    'import * as Stagehand from "./lib/v3/index.js";',
    'export * from "./lib/v3/index.js";',
    "export default Stagehand;",
    "",
  ].join("\n"),
);

fs.mkdirSync(`${repoRoot}/packages/core/dist/esm/lib/v3/dom/build`, {
  recursive: true,
});
// DOM script bundles are generated artifacts (not TS emit); copy into dist/esm for runtime.
if (fs.existsSync(`${repoRoot}/packages/core/lib/v3/dom/build`)) {
  for (const file of fs.readdirSync(
    `${repoRoot}/packages/core/lib/v3/dom/build`,
  )) {
    if (file.endsWith(".js")) {
      fs.copyFileSync(
        `${repoRoot}/packages/core/lib/v3/dom/build/${file}`,
        `${repoRoot}/packages/core/dist/esm/lib/v3/dom/build/${file}`,
      );
    }
  }
}

// Note: evals + server test outputs are built by their respective packages.

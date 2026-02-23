/**
 * Build canonical dist/esm output for the core package (including tests).
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

const runNodeScript = (scriptPath: string, args: string[]) => {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    stdio: "inherit",
    cwd: repoRoot,
  });
  if (result.error) {
    console.error(`Failed to run node ${scriptPath} ${args.join(" ")}`);
    console.error(result.error);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
};

fs.rmSync(`${repoRoot}/packages/core/dist/esm`, {
  recursive: true,
  force: true,
});

// Core ESM emit includes generated lib/version.ts from gen-version (run in core build).
runNodeScript(`${repoRoot}/node_modules/typescript/bin/tsc`, [
  "-p",
  "packages/core/tsconfig.json",
  "--declaration",
]);
// Tests run via node/playwright need JS test files; esbuild emits ESM test JS into dist/esm.
// Unit tests are in tests/unit/, integration tests are in tests/integration/
const testEntryPoints = collectTsFiles(`${repoRoot}/packages/core/tests`);
if (testEntryPoints.length > 0) {
  esbuild.buildSync({
    entryPoints: testEntryPoints,
    outdir: "packages/core/dist/esm",
    outbase: "packages/core",
    format: "esm",
    platform: "node",
    sourcemap: true,
    logLevel: "warning",
    absWorkingDir: repoRoot,
  });
}

fs.mkdirSync(`${repoRoot}/packages/core/dist/esm`, { recursive: true });
fs.writeFileSync(
  `${repoRoot}/packages/core/dist/esm/package.json`,
  '{\n  "type": "module"\n}\n',
);
fs.writeFileSync(
  `${repoRoot}/packages/core/dist/esm/index.js`,
  `export * from "./lib/v3/index.js";
export { default } from "./lib/v3/index.js";
`,
);
fs.writeFileSync(
  `${repoRoot}/packages/core/dist/esm/index.d.ts`,
  `export * from "./lib/v3/index.js";
export { default } from "./lib/v3/index.js";
`,
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

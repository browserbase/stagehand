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
import { getRepoRootDir } from "../lib/v3/runtimePaths.js";

const repoRoot = getRepoRootDir();

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

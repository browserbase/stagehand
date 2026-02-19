/**
 * Build canonical dist/ (CJS) output for the core package, including types.
 *
 * Prereqs: pnpm install; run gen-version + build-dom-scripts first (turbo handles).
 * Args: none.
 * Env: none.
 * Example: pnpm run build:cjs
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

fs.rmSync(`${repoRoot}/packages/core/dist/cjs`, {
  recursive: true,
  force: true,
});
fs.mkdirSync(`${repoRoot}/packages/core/dist/cjs`, { recursive: true });

run([
  "exec",
  "esbuild",
  "packages/core/lib/v3/index.ts",
  "--bundle",
  "--platform=node",
  "--format=cjs",
  "--target=node20",
  "--outfile=packages/core/dist/cjs/index.js",
  "--sourcemap",
  "--packages=external",
  "--log-override:empty-import-meta=silent",
  "--log-level=warning",
]);

run([
  "exec",
  "esbuild",
  "packages/core/lib/v3/cli.js",
  "--bundle",
  "--platform=node",
  "--format=cjs",
  "--target=node20",
  "--outfile=packages/core/dist/cjs/cli.js",
  "--sourcemap",
  "--packages=external",
  "--log-level=warning",
]);

// Unit + e2e test scripts can run against dist/cjs when these test files are emitted.
run([
  "exec",
  "esbuild",
  "packages/core/tests/**/*.ts",
  "packages/core/lib/v3/tests/**/*.ts",
  "--outdir=packages/core/dist/cjs",
  "--outbase=packages/core",
  "--format=cjs",
  "--platform=node",
  "--sourcemap",
  "--log-override:empty-import-meta=silent",
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
  `${repoRoot}/packages/core/dist/cjs/index.d.ts`,
  'export * from "./lib/v3/index";\n',
);
fs.writeFileSync(
  `${repoRoot}/packages/core/dist/cjs/package.json`,
  '{\n  "type": "commonjs"\n}\n',
);

fs.mkdirSync(`${repoRoot}/packages/core/dist/cjs/lib/v3/dom/build`, {
  recursive: true,
});
if (fs.existsSync(`${repoRoot}/packages/core/lib/v3/dom/build`)) {
  for (const file of fs.readdirSync(
    `${repoRoot}/packages/core/lib/v3/dom/build`,
  )) {
    if (file.endsWith(".js")) {
      fs.copyFileSync(
        `${repoRoot}/packages/core/lib/v3/dom/build/${file}`,
        `${repoRoot}/packages/core/dist/cjs/lib/v3/dom/build/${file}`,
      );
    }
  }
}

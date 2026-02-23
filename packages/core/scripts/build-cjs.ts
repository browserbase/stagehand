/**
 * Build canonical dist/ (CJS) output for the core package, including types & sourcemaps.
 *
 * Prereqs: pnpm install; run gen-version + build-dom-scripts first (turbo handles).
 * Args: none.
 * Env: none.
 * Example: pnpm run build:cjs
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";

const repoRoot = (() => {
  const value = fileURLToPath(import.meta.url).replaceAll("\\", "/");
  const root = value.split("/packages/core/")[0];
  if (root === value) {
    throw new Error(`Unable to determine repo root from ${value}`);
  }
  return root;
})();

const toRepoRelative = (absPath: string) =>
  path.relative(repoRoot, absPath).replaceAll("\\", "/");

const collectTsFiles = (dir: string): string[] => {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;

  const entries = fs
    .readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectTsFiles(fullPath));
      continue;
    }
    if (
      entry.isFile() &&
      fullPath.endsWith(".ts") &&
      !fullPath.endsWith(".d.ts")
    ) {
      out.push(toRepoRelative(fullPath));
    }
  }

  return out;
};

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

fs.rmSync(`${repoRoot}/packages/core/dist/cjs`, {
  recursive: true,
  force: true,
});
fs.mkdirSync(`${repoRoot}/packages/core/dist/cjs`, { recursive: true });

esbuild.buildSync({
  entryPoints: ["packages/core/lib/v3/index.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  outfile: "packages/core/dist/cjs/index.js",
  sourcemap: true,
  packages: "external",
  logOverride: {
    "empty-import-meta": "silent",
  },
  logLevel: "warning",
  absWorkingDir: repoRoot,
});

esbuild.buildSync({
  entryPoints: ["packages/core/lib/v3/cli.js"],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  outfile: "packages/core/dist/cjs/cli.js",
  sourcemap: true,
  packages: "external",
  logLevel: "warning",
  absWorkingDir: repoRoot,
});

// Unit + e2e test scripts can run against dist/cjs when these test files are emitted.
// Unit tests are in tests/unit/, integration tests are in tests/integration/
const testEntryPoints = collectTsFiles(`${repoRoot}/packages/core/tests`);
if (testEntryPoints.length > 0) {
  esbuild.buildSync({
    entryPoints: testEntryPoints,
    outdir: "packages/core/dist/cjs",
    outbase: "packages/core",
    format: "cjs",
    platform: "node",
    target: "node20",
    sourcemap: true,
    logOverride: {
      "empty-import-meta": "silent",
    },
    logLevel: "warning",
    absWorkingDir: repoRoot,
  });
}

runNodeScript(`${repoRoot}/node_modules/typescript/bin/tsc`, [
  "-p",
  "packages/core/tsconfig.json",
  "--declaration",
  "--emitDeclarationOnly",
  "--outDir",
  "packages/core/dist/cjs",
]);

fs.writeFileSync(
  `${repoRoot}/packages/core/dist/cjs/index.d.ts`,
  `export * from "./lib/v3/index";
export { default } from "./lib/v3/index";
`,
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

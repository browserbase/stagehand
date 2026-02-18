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

const RELATIVE_SPECIFIER_RE = /^\.{1,2}\//;
const HAS_FILE_EXTENSION_RE = /\/[^/]+\.[^/]+$/;
const RUNTIME_EXTENSIONS = new Set([
  ".js",
  ".mjs",
  ".cjs",
  ".json",
  ".node",
  ".wasm",
]);

const resolveRuntimeSpecifier = (
  importerPath: string,
  specifier: string,
): string | null => {
  if (!RELATIVE_SPECIFIER_RE.test(specifier)) return null;
  if (specifier.includes("?") || specifier.includes("#")) return null;
  if (HAS_FILE_EXTENSION_RE.test(specifier)) {
    const ext = path.extname(specifier);
    if (RUNTIME_EXTENSIONS.has(ext)) return null;
  }

  const importerDir = path.dirname(importerPath);
  const resolved = path.resolve(importerDir, specifier);
  if (fs.existsSync(`${resolved}.js`)) {
    return `${specifier}.js`;
  }
  if (fs.existsSync(path.join(resolved, "index.js"))) {
    return specifier.endsWith("/")
      ? `${specifier}index.js`
      : `${specifier}/index.js`;
  }
  return null;
};

const rewriteFileRuntimeSpecifiers = (filePath: string) => {
  const source = fs.readFileSync(filePath, "utf8");
  const replaceSpecifier = (
    full: string,
    prefix: string,
    spec: string,
    suffix: string,
  ) => {
    const resolved = resolveRuntimeSpecifier(filePath, spec);
    if (!resolved) return full;
    return `${prefix}${resolved}${suffix}`;
  };

  const rewritten = source
    .replace(/(\bimport\s*\(\s*")([^"]+)(")/g, (full, prefix, spec, suffix) =>
      replaceSpecifier(full, prefix, spec, suffix),
    )
    .replace(/(\bimport\s*\(\s*')([^']+)(')/g, (full, prefix, spec, suffix) =>
      replaceSpecifier(full, prefix, spec, suffix),
    )
    .replace(/(\bfrom\s*")([^"]+)(")/g, (full, prefix, spec, suffix) =>
      replaceSpecifier(full, prefix, spec, suffix),
    )
    .replace(/(\bfrom\s*')([^']+)(')/g, (full, prefix, spec, suffix) =>
      replaceSpecifier(full, prefix, spec, suffix),
    )
    .replace(/(\bimport\s*")([^"]+)(")/g, (full, prefix, spec, suffix) =>
      replaceSpecifier(full, prefix, spec, suffix),
    )
    .replace(/(\bimport\s*')([^']+)(')/g, (full, prefix, spec, suffix) =>
      replaceSpecifier(full, prefix, spec, suffix),
    );

  if (rewritten !== source) {
    fs.writeFileSync(filePath, rewritten);
  }
};

const rewriteDistRuntimeSpecifiers = (dir: string) => {
  if (!fs.existsSync(dir)) return;
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && fullPath.endsWith(".js")) {
        rewriteFileRuntimeSpecifiers(fullPath);
      }
    }
  };
  walk(dir);
};

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

// Node ESM does not resolve extensionless relative imports by default.
// Rewrite dist specifiers to explicit ".js" (or "/index.js") for runtime safety.
rewriteDistRuntimeSpecifiers(coreDist);

// Note: evals + server test outputs are built by their respective packages.

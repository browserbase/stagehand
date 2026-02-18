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

const run = (args: string[]) => {
  const result = spawnSync("pnpm", args, { stdio: "inherit", cwd: repoRoot });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
};

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

// Node ESM does not resolve extensionless relative imports by default.
// Rewrite dist specifiers to explicit ".js" (or "/index.js") for runtime safety.
rewriteDistRuntimeSpecifiers(evalsDist);

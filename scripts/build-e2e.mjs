import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SRC_DIR = path.join(ROOT, "evals", "deterministic");
const OUT_BASE = path.join(ROOT, "dist", "playwright");
const OUT_DIR = path.join(OUT_BASE, "evals", "deterministic");
const STAGEHAND_ENTRY = path.join(ROOT, "dist", "index.js");
const IMPORT_META_DECL =
  'var import_meta = { url: require("node:url").pathToFileURL(__filename).href };';

const shouldLink = (() => {
  const flag = process.env.STAGEHAND_SKIP_NPM_LINK ?? "";
  return flag !== "1" && flag.toLowerCase() !== "true";
})();

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function copyDir(src, dest) {
  if (!fs.existsSync(src)) return;
  ensureDir(dest);
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const source = path.join(src, entry.name);
    const target = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(source, target);
    else fs.copyFileSync(source, target);
  }
}

function patchImportMeta(filePath) {
  let content = fs.readFileSync(filePath, "utf8");
  if (!content.includes("var import_meta = {}")) {
    return;
  }

  content = content.replace("var import_meta = {};", IMPORT_META_DECL);
  content = content.replaceAll('"globalSetup.ts"', '"globalSetup.js"');
  fs.writeFileSync(filePath, content, "utf8");
}

function rewriteStagehandImports(filePath) {
  let content = fs.readFileSync(filePath, "utf8");
  if (!content.includes("@browserbasehq/stagehand")) {
    return;
  }

  const relative = path.relative(path.dirname(filePath), STAGEHAND_ENTRY);
  const basePath = relative.startsWith(".") ? relative : "./" + relative;
  const importPath = basePath.split(path.sep).join("/");

  content = content.replaceAll(
    'require("@browserbasehq/stagehand")',
    'require("' + importPath + '")',
  );
  content = content.replaceAll(
    'from "@browserbasehq/stagehand"',
    'from "' + importPath + '"',
  );

  fs.writeFileSync(filePath, content, "utf8");
}

function traverseOutputs(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      traverseOutputs(entryPath);
    } else if (entry.isFile() && entry.name.endsWith(".js")) {
      patchImportMeta(entryPath);
      rewriteStagehandImports(entryPath);
    }
  }
}

async function main() {
  ensureDir(OUT_DIR);

  const entryPoints = [];
  const collectEntryPoints = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) collectEntryPoints(entryPath);
      else if (entry.isFile() && entryPath.endsWith(".ts")) {
        entryPoints.push(entryPath);
      }
    }
  };
  collectEntryPoints(SRC_DIR);

  const pkgJson = JSON.parse(
    fs.readFileSync(path.join(ROOT, "package.json"), "utf8"),
  );
  const externalDeps = Array.from(
    new Set([
      ...Object.keys(pkgJson.dependencies ?? {}),
      ...Object.keys(pkgJson.peerDependencies ?? {}),
      ...Object.keys(pkgJson.optionalDependencies ?? {}),
      "@playwright/test",
      "playwright",
    ]),
  );

  await build({
    entryPoints,
    outbase: ROOT,
    outdir: OUT_BASE,
    platform: "node",
    target: "es2022",
    format: "cjs",
    bundle: true,
    sourcemap: true,
    tsconfig: path.join(SRC_DIR, "tsconfig.playwright.json"),
    packages: "external",
    external: externalDeps,
    banner: {
      js: "var __name = (target, value) => { try { Object.defineProperty(target, 'name', { value, configurable: true }); } catch {} return target; };",
    },
    logLevel: "silent",
  });

  traverseOutputs(OUT_BASE);

  copyDir(path.join(SRC_DIR, "auxiliary"), path.join(OUT_DIR, "auxiliary"));

  if (shouldLink) {
    const linkResult = spawnSync("npm", ["link"], {
      stdio: "inherit",
      shell: process.platform === "win32",
    });

    if ((linkResult.status ?? 0) !== 0) {
      process.exit(linkResult.status ?? 1);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

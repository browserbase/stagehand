/**
 * Pre-bundle the Stagehand v4 JS SDK into a single self-contained ESM file that
 * the evals build can import: core/tools/vendor/stagehand-v4.js.
 *
 * The v4 SDK (`stagehand-v4`) ships TypeScript source only and pulls in
 * workspace deps (@browserbasehq/stagehand-server, modcdp, stagehand-extension),
 * so it can't be imported directly by the plain-node evals CLI. esbuild resolves
 * the SDK's TS + its deps from the v4 repo and inlines them here.
 *
 * Prereqs: a stagehand-v4 checkout with deps installed, at ../stagehand-v4
 *          (relative to the repo root) or wherever $STAGEHAND_V4_DIR points.
 * Args: none.
 * Example:
 *   pnpm run build:v4shim        # just (re)build the bundle
 *   pnpm run build:v4            # build the bundle, then rebuild the CLI
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { getRepoRootDir } from "../runtimePaths.js";

const repoRoot = getRepoRootDir();
const evalsDir = path.join(repoRoot, "packages/evals");

const v4Dir = process.env.STAGEHAND_V4_DIR
  ? path.resolve(process.env.STAGEHAND_V4_DIR)
  : path.resolve(repoRoot, "../stagehand-v4");

const outfile = path.join(evalsDir, "core/tools/vendor/stagehand-v4.js");

// The v4 repo is under active restructuring (the JS SDK has moved between
// sdks/js and a top-level stagehand-js, etc.), so resolve the entry from a few
// known locations rather than hard-coding one. Override with STAGEHAND_V4_SDK_ENTRY.
const entryCandidates = [
  process.env.STAGEHAND_V4_SDK_ENTRY,
  path.join(v4Dir, "stagehand-js/index.ts"),
  path.join(v4Dir, "sdks/js/index.ts"),
].filter((p): p is string => Boolean(p));

const entry = entryCandidates.find((p) => fs.existsSync(p));

if (!entry) {
  console.error(
    `[build:v4shim] Could not find the v4 SDK entry. Looked in:\n` +
      entryCandidates.map((p) => `  ${p}`).join("\n") +
      `\n\nSet STAGEHAND_V4_DIR to your stagehand-v4 checkout (or ` +
      `STAGEHAND_V4_SDK_ENTRY to the SDK's index.ts directly), e.g.\n` +
      `  STAGEHAND_V4_DIR=/path/to/stagehand-v4 pnpm run build:v4shim`,
  );
  process.exit(1);
}

console.log(`[build:v4shim] bundling from ${entry}`);

fs.mkdirSync(path.dirname(outfile), { recursive: true });

// Resolve esbuild from this monorepo, but bundle the entry from the v4 repo —
// esbuild resolves each import relative to its own file, so the v4 SDK's
// workspace deps come from the v4 repo's node_modules regardless of cwd.
const result = spawnSync(
  "pnpm",
  [
    "exec",
    "esbuild",
    entry,
    "--bundle",
    "--platform=node",
    "--format=esm",
    `--outfile=${outfile}`,
    "--sourcemap",
    "--log-level=warning",
    // The v4 SDK pulls in CommonJS deps (e.g. node-fetch) that `require()` Node
    // built-ins. esbuild's ESM output otherwise emits a stub that throws
    // "Dynamic require of 'stream' is not supported" at import time. Inject a
    // real require so those resolve. (See also build-cli.ts, which re-bundles
    // this file into the CLI.)
    "--banner:js=import { createRequire as __shCreateRequire } from 'node:module'; const require = __shCreateRequire(import.meta.url);",
  ],
  { stdio: "inherit", cwd: repoRoot },
);

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

console.log(`[build:v4shim] wrote ${path.relative(repoRoot, outfile)}`);

// Provide the browser-extension zip the bundled SDK needs at launch. Bundling
// breaks the SDK's own resolution: un-bundled, it finds the zip via
// `<runtimeDir>/stagehand-extension.zip` where runtimeDir is the SDK's own
// directory (which ships a version-matched zip). Bundled, runtimeDir becomes
// dist/cli (dirname of cli.js), so we copy that SAME version-matched zip there.
//
// Using the SDK-colocated zip is important: a mismatched extension build (e.g.
// src/extension/.output) lacks the globals the SDK injects against and fails
// connect() with "globalThis.__stagehandCallModCDPCommand is not a function".
const sdkDir = path.dirname(entry);
const zipCandidates = [
  process.env.STAGEHAND_V4_EXTENSION_ZIP,
  path.join(sdkDir, "stagehand", "stagehand-extension.zip"),
  path.join(sdkDir, "stagehand-extension.zip"),
  path.join(
    v4Dir,
    "stagehand-extension/.output/chrome-mv3/stagehand-extension.zip",
  ),
].filter((p): p is string => Boolean(p));

const sourceZip = zipCandidates.find((p) => fs.existsSync(p));

if (sourceZip) {
  const cliDir = path.join(evalsDir, "dist/cli");
  fs.mkdirSync(cliDir, { recursive: true });
  const destZip = path.join(cliDir, "stagehand-extension.zip");
  fs.copyFileSync(sourceZip, destZip);
  console.log(
    `[build:v4shim] extension zip: ${sourceZip}\n` +
      `[build:v4shim]   -> ${path.relative(repoRoot, destZip)} (run build:cli after this)`,
  );
} else {
  console.warn(
    `[build:v4shim] WARNING: no stagehand-extension.zip found. Looked in:\n` +
      zipCandidates.map((p) => `  ${p}`).join("\n") +
      `\n  Local launch (tool_launch_local) will fail to load the Stagehand ` +
      `extension. Set STAGEHAND_V4_EXTENSION_ZIP or build it in the v4 repo, ` +
      `then re-run build:v4.`,
  );
}

/**
 * Build the v3 DOM script into a single JS file and then export its contents
 * as a string constant (`v3ScriptContent`) for CDP injection (document-start).
 */
import fs from "node:fs";
import path from "node:path";
import esbuild from "esbuild";
import { getCurrentDirPath } from "../runtimePaths.js";

const here = getCurrentDirPath();
const outDir = path.join(here, "./build");
fs.mkdirSync(outDir, { recursive: true });

esbuild.buildSync({
  entryPoints: [path.join(here, "piercer.entry.ts")],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2020",
  minify: true,
  legalComments: "none",
  outfile: path.join(outDir, "v3-index.js"),
});

const script = fs.readFileSync(path.join(outDir, "v3-index.js"), "utf8");
const content = `export const v3ScriptContent = ${JSON.stringify(script)};`;

fs.writeFileSync(path.join(outDir, "scriptV3Content.ts"), content);

esbuild.buildSync({
  entryPoints: [path.join(here, "rerenderMissingShadows.entry.ts")],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2020",
  minify: true,
  legalComments: "none",
  outfile: path.join(outDir, "rerender-index.js"),
});

const rerenderScript = fs.readFileSync(
  path.join(outDir, "rerender-index.js"),
  "utf8",
);
const rerenderContent = `export const reRenderScriptContent = ${JSON.stringify(
  rerenderScript,
)};`;
fs.writeFileSync(
  path.join(outDir, "reRenderScriptContent.ts"),
  rerenderContent,
);

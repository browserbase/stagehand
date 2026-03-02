import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import esbuild from "esbuild";
import { getCurrentDirPath } from "../runtimePaths.js";

const here = getCurrentDirPath();
const outDir = path.join(here, "./build");
const entry = path.join(here, "./locatorScripts/index.ts");
const moduleOutfile = path.join(outDir, "locatorScripts.mjs");
const bundleOutfile = path.join(outDir, "locatorScripts.bundle.js");

async function main(): Promise<void> {
  fs.mkdirSync(outDir, { recursive: true });

  esbuild.buildSync({
    entryPoints: [entry],
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2020",
    minify: true,
    outfile: moduleOutfile,
  });

  esbuild.buildSync({
    entryPoints: [entry],
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2020",
    globalName: "__stagehandLocatorScriptsFactory",
    minify: true,
    outfile: bundleOutfile,
  });

  const bundleRaw = fs.readFileSync(bundleOutfile, "utf8").trim();
  const bootstrap = `if (!globalThis.__stagehandLocatorScripts) { ${bundleRaw}\n  globalThis.__stagehandLocatorScripts = __stagehandLocatorScriptsFactory;\n}`;

  const compiledModule = (await import(
    pathToFileURL(moduleOutfile).href
  )) as Record<string, unknown>;

  const entries = Object.entries(compiledModule).filter(
    ([, value]) => typeof value === "function",
  );
  const sorted = entries.sort(([a], [b]) => a.localeCompare(b));

  const scriptMap: Record<string, string> = Object.fromEntries(
    sorted.map(([name, fn]) => {
      const callable = fn as (...args: unknown[]) => unknown;
      return [name, callable.toString()];
    }),
  );

  const banner = `/*\n * AUTO-GENERATED FILE. DO NOT EDIT.\n * Update sources in lib/v3/dom/locatorScripts and run genLocatorScripts.ts.\n */`;

  const globalRefs: Record<string, string> = Object.fromEntries(
    sorted.map(([name]) => [
      name,
      `globalThis.__stagehandLocatorScripts.${name}`,
    ]),
  );

  const content = `${banner}\nexport const locatorScriptBootstrap = ${JSON.stringify(bootstrap)};\nexport const locatorScriptSources = ${JSON.stringify(scriptMap, null, 2)} as const;\nexport const locatorScriptGlobalRefs = ${JSON.stringify(globalRefs, null, 2)} as const;\nexport type LocatorScriptName = keyof typeof locatorScriptSources;\n`;

  fs.writeFileSync(path.join(outDir, "locatorScripts.generated.ts"), content);

  await fs.promises.unlink(moduleOutfile).catch(() => {});
  await fs.promises.unlink(bundleOutfile).catch(() => {});
}

void main();

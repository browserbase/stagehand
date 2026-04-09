/**
 * Unified builder for all browser-injected DOM scripts.
 *
 * Bundles TypeScript source into minified strings that get injected into
 * browser contexts via CDP at runtime.
 *
 * Run: pnpm run build-dom-scripts
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import esbuild from "esbuild";
import { getPackageRootDir } from "../lib/v3/runtimePaths.js";

const packageRoot = getPackageRootDir();
const domDir = path.join(packageRoot, "lib/v3/dom");
const outDir = path.join(domDir, "build");

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

type IIFEStringConfig = {
  type: "iife-string";
  entry: string; // relative to domDir
  exportName: string;
  outputFile: string;
};

type BootstrapModuleConfig = {
  type: "bootstrap-module";
  entry: string;
  /** Global variable name, e.g. "__stagehandLocatorScripts" */
  globalName: string;
  /** Export prefix, e.g. "locatorScript" → locatorScriptBootstrap, locatorScriptSources, etc. */
  prefix: string;
  outputFile: string;
};

type SourcesOnlyConfig = {
  type: "sources-only";
  entry: string;
  prefix: string;
  outputFile: string;
};

type ScriptConfig =
  | IIFEStringConfig
  | BootstrapModuleConfig
  | SourcesOnlyConfig;

const scripts: ScriptConfig[] = [
  {
    type: "iife-string",
    entry: "piercer.entry.ts",
    exportName: "v3ScriptContent",
    outputFile: "scriptV3Content.ts",
  },
  {
    type: "iife-string",
    entry: "rerenderMissingShadows.entry.ts",
    exportName: "reRenderScriptContent",
    outputFile: "reRenderScriptContent.ts",
  },
  {
    type: "bootstrap-module",
    entry: "locatorScripts/index.ts",
    globalName: "__stagehandLocatorScripts",
    prefix: "locatorScript",
    outputFile: "locatorScripts.generated.ts",
  },
  {
    type: "bootstrap-module",
    entry: "a11yScripts/index.ts",
    globalName: "__stagehandA11yScripts",
    prefix: "a11yScript",
    outputFile: "a11yScripts.generated.ts",
  },
  {
    type: "sources-only",
    entry: "screenshotScripts/index.ts",
    prefix: "screenshotScript",
    outputFile: "screenshotScripts.generated.ts",
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function bundleIIFE(entryPoint: string, globalName?: string): string {
  const tmpFile = path.join(
    outDir,
    `_tmp_${Date.now()}_${Math.random().toString(36).slice(2)}.js`,
  );
  try {
    esbuild.buildSync({
      entryPoints: [entryPoint],
      bundle: true,
      format: "iife",
      platform: "browser",
      target: "es2020",
      minify: true,
      legalComments: "none",
      ...(globalName ? { globalName } : {}),
      outfile: tmpFile,
    });
    return fs.readFileSync(tmpFile, "utf8").trim();
  } finally {
    fs.rmSync(tmpFile, { force: true });
  }
}

async function extractFunctionSources(
  entryPoint: string,
): Promise<[string, string][]> {
  const tmpFile = path.join(
    outDir,
    `_tmp_${Date.now()}_${Math.random().toString(36).slice(2)}.mjs`,
  );
  try {
    esbuild.buildSync({
      entryPoints: [entryPoint],
      bundle: true,
      format: "esm",
      platform: "browser",
      target: "es2020",
      minify: true,
      outfile: tmpFile,
    });
    const mod = (await import(pathToFileURL(tmpFile).href)) as Record<
      string,
      unknown
    >;
    return Object.entries(mod)
      .filter(([, value]) => typeof value === "function")
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, fn]) => [
        name,
        (fn as (...args: unknown[]) => unknown).toString(),
      ]);
  } finally {
    fs.rmSync(tmpFile, { force: true });
  }
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

async function buildIIFEString(config: IIFEStringConfig): Promise<void> {
  const entryPoint = path.join(domDir, config.entry);
  const js = bundleIIFE(entryPoint);
  const content = `export const ${config.exportName} = ${JSON.stringify(js)};\n`;
  fs.writeFileSync(path.join(outDir, config.outputFile), content);
}

async function buildBootstrapModule(
  config: BootstrapModuleConfig,
): Promise<void> {
  const entryPoint = path.join(domDir, config.entry);
  const factoryName = `${config.globalName}Factory`;

  // Bundle IIFE for bootstrap
  const iifeRaw = bundleIIFE(entryPoint, factoryName);
  const bootstrap = `if (!globalThis.${config.globalName}) { ${iifeRaw}\n  globalThis.${config.globalName} = ${factoryName};\n}`;

  // Extract individual function sources
  const functions = await extractFunctionSources(entryPoint);

  const sources: Record<string, string> = Object.fromEntries(functions);
  const globalRefs: Record<string, string> = Object.fromEntries(
    functions.map(([name]) => [
      name,
      `globalThis.${config.globalName}.${name}`,
    ]),
  );

  const banner = `/*\n * AUTO-GENERATED FILE. DO NOT EDIT.\n * Run \`pnpm run build-dom-scripts\` to regenerate.\n */`;
  const content = `${banner}\nexport const ${config.prefix}Bootstrap = ${JSON.stringify(bootstrap)};\nexport const ${config.prefix}Sources = ${JSON.stringify(sources, null, 2)} as const;\nexport const ${config.prefix}GlobalRefs = ${JSON.stringify(globalRefs, null, 2)} as const;\nexport type ${config.prefix.charAt(0).toUpperCase() + config.prefix.slice(1)}Name = keyof typeof ${config.prefix}Sources;\n`;

  fs.writeFileSync(path.join(outDir, config.outputFile), content);
}

async function buildSourcesOnly(config: SourcesOnlyConfig): Promise<void> {
  const entryPoint = path.join(domDir, config.entry);
  const functions = await extractFunctionSources(entryPoint);
  const sources: Record<string, string> = Object.fromEntries(functions);

  const banner = `/*\n * AUTO-GENERATED FILE. DO NOT EDIT.\n * Run \`pnpm run build-dom-scripts\` to regenerate.\n */`;
  const content = `${banner}\nexport const ${config.prefix}Sources = ${JSON.stringify(sources, null, 2)} as const;\nexport type ${config.prefix.charAt(0).toUpperCase() + config.prefix.slice(1)}Name = keyof typeof ${config.prefix}Sources;\n`;

  fs.writeFileSync(path.join(outDir, config.outputFile), content);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  fs.mkdirSync(outDir, { recursive: true });

  await Promise.all(
    scripts.map((config) => {
      switch (config.type) {
        case "iife-string":
          return buildIIFEString(config);
        case "bootstrap-module":
          return buildBootstrapModule(config);
        case "sources-only":
          return buildSourcesOnly(config);
      }
    }),
  );
}

void main();

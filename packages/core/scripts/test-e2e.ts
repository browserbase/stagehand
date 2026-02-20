/**
 * E2E tests (Playwright) on dist/esm tests.
 *
 * Prereqs: pnpm run build:esm (packages/core/dist/esm/lib/v3/tests present).
 * Args: [test paths...] -- [playwright args...] | --list (prints JSON matrix).
 * Env: STAGEHAND_BROWSER_TARGET=local|browserbase, CHROME_PATH (local),
 *      NODE_V8_COVERAGE, PLAYWRIGHT_CONSOLE_REPORTER;
 *      writes CTRF to ctrf/playwright-*.xml by default.
 * Example: STAGEHAND_BROWSER_TARGET=browserbase pnpm run test:e2e -- packages/core/dist/esm/lib/v3/tests/foo.spec.js
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import {
  ensureParentDir,
  parseListFlag,
  splitArgs,
  collectFiles,
  toSafeName,
  writeCtrfFromJunit,
} from "./test-utils.js";

const repoRoot = (() => {
  const value = fileURLToPath(import.meta.url).replaceAll("\\", "/");
  const root = value.split("/packages/core/")[0];
  if (root === value) {
    throw new Error(`Unable to determine repo root from ${value}`);
  }
  return root;
})();

const testsDir = `${repoRoot}/packages/core/dist/esm/lib/v3/tests`;
const defaultConfigPath = `${repoRoot}/packages/core/dist/esm/lib/v3/tests/v3.playwright.config.js`;

const resolveRepoRelative = (value: string) =>
  path.isAbsolute(value) ? value : path.resolve(repoRoot, value);
const require = createRequire(import.meta.url);
const playwrightCliPath = require.resolve("@playwright/test/cli");

const hasConfigArg = (argsList: string[]) =>
  argsList.some((arg, i) => {
    if (arg.startsWith("--config=")) return true;
    return arg === "--config" && Boolean(argsList[i + 1]);
  });

const stripReporterArgs = (argsList: string[]) => {
  const filtered: string[] = [];
  let removed = false;
  for (let i = 0; i < argsList.length; i++) {
    const arg = argsList[i];
    if (
      arg === "--reporter" ||
      arg === "-r" ||
      arg.startsWith("--reporter=") ||
      arg.startsWith("-r=")
    ) {
      removed = true;
      if ((arg === "--reporter" || arg === "-r") && argsList[i + 1]) {
        i += 1;
      }
      continue;
    }
    filtered.push(arg);
  }
  return { filtered, removed };
};

const toTestName = (testPath: string) => {
  const abs = resolveRepoRelative(testPath);
  const rel = path.relative(testsDir, abs).replaceAll("\\", "/");
  if (!rel.startsWith("..")) {
    return rel.replace(/\.spec\.(ts|js)$/i, "");
  }
  return path.basename(abs).replace(/\.spec\.(ts|js)$/i, "");
};

const toPlaywrightPath = (testPath: string) => {
  const abs = resolveRepoRelative(testPath);
  const rel = path.relative(testsDir, abs).replaceAll("\\", "/");
  const value = rel.startsWith("..") ? abs : rel;
  return value.replace(/(\.spec|\.test)\.(ts|js)$/i, "$1");
};

if (!fs.existsSync(testsDir)) {
  console.error(
    "Missing packages/core/dist/esm/lib/v3/tests. Run pnpm run build:esm first.",
  );
  process.exit(1);
}

const listFlag = parseListFlag(process.argv.slice(2));
const { paths, extra } = splitArgs(listFlag.args);

if (listFlag.list) {
  const tests = collectFiles(testsDir, ".spec.js");
  const entries = tests.map((file) => {
    const rel = path.relative(testsDir, file).replace(/\.spec\.js$/, "");
    return {
      path: path.relative(repoRoot, file),
      name: rel,
      safe_name: toSafeName(rel),
    };
  });
  console.log(JSON.stringify(entries));
  process.exit(0);
}

const { filtered: extraArgs, removed: removedReporterOverride } =
  stripReporterArgs(extra);
if (removedReporterOverride) {
  console.warn(
    "Ignoring Playwright --reporter override to preserve console + JUnit output.",
  );
}

const hasUserConfig = hasConfigArg(extraArgs);
if (!hasUserConfig && !fs.existsSync(defaultConfigPath)) {
  console.error(`Missing Playwright config at ${defaultConfigPath}.`);
  process.exit(1);
}

const playwrightPaths = paths.map(toPlaywrightPath);

const target = (process.env.STAGEHAND_BROWSER_TARGET ?? "local").toLowerCase();
const useBrowserbase = target === "browserbase";
const relTestName = paths.length === 1 ? toTestName(paths[0]) : null;

const coverageDir = resolveRepoRelative(
  process.env.NODE_V8_COVERAGE ??
    (relTestName
      ? `${repoRoot}/coverage/${useBrowserbase ? "e2e-bb" : "e2e-local"}/${relTestName}`
      : `${repoRoot}/coverage/${useBrowserbase ? "e2e-bb" : "e2e-local"}`),
);
fs.mkdirSync(coverageDir, { recursive: true });

const defaultJunitPath = relTestName
  ? `${repoRoot}/ctrf/${useBrowserbase ? "e2e-bb" : "e2e-local"}/${relTestName}.xml`
  : `${repoRoot}/ctrf/${useBrowserbase ? "e2e-bb" : "e2e-local"}/all.xml`;
const ctrfPath = process.env.CTRF_JUNIT_PATH
  ? resolveRepoRelative(process.env.CTRF_JUNIT_PATH)
  : defaultJunitPath;
ensureParentDir(ctrfPath);

const baseNodeOptions = "--enable-source-maps";
const nodeOptions = [process.env.NODE_OPTIONS, baseNodeOptions]
  .filter(Boolean)
  .join(" ");

const env = {
  ...process.env,
  NODE_OPTIONS: nodeOptions,
  NODE_V8_COVERAGE: coverageDir,
  CTRF_JUNIT_PATH: ctrfPath,
};

const result = spawnSync(
  process.execPath,
  [
    playwrightCliPath,
    "test",
    ...(hasUserConfig ? [] : ["--config", defaultConfigPath]),
    ...extraArgs,
    ...playwrightPaths,
  ],
  { stdio: "inherit", env, cwd: repoRoot },
);

writeCtrfFromJunit(ctrfPath, "playwright");

process.exit(result.status ?? 1);

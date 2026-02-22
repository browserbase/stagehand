/**
 * E2E tests (Playwright) on dist/esm tests.
 *
 * Prereqs: pnpm run build:esm (packages/core/dist/esm/tests/integration present).
 * Args: [test paths...] -- [playwright args...] | --list (prints JSON matrix).
 * Env: STAGEHAND_BROWSER_TARGET=local|browserbase, CHROME_PATH (local),
 *      NODE_V8_COVERAGE, PLAYWRIGHT_CONSOLE_REPORTER;
 *      writes CTRF to ctrf/playwright-*.xml by default.
 * Example: STAGEHAND_BROWSER_TARGET=browserbase pnpm run test:e2e -- packages/core/dist/esm/tests/integration/foo.spec.js
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import {
  parseListFlag,
  splitArgs,
  collectFiles,
  toSafeName,
  writeCtrfFromJunit,
} from "../../../scripts/test-utils.js";
import {
  initCoverageDir,
  initJunitPath,
  withCoverageEnv,
  withCtrfEnv,
  maybeWriteCtrf,
} from "../../../scripts/test-artifacts.js";

const repoRoot = (() => {
  const value = fileURLToPath(import.meta.url).replaceAll("\\", "/");
  const root = value.split("/packages/core/")[0];
  if (root === value) {
    throw new Error(`Unable to determine repo root from ${value}`);
  }
  return root;
})();

const sourceTestsDir = `${repoRoot}/packages/core/tests/integration`;
const testsDir = `${repoRoot}/packages/core/dist/esm/tests/integration`;
const defaultConfigPath = `${repoRoot}/packages/core/dist/esm/tests/integration/v3.playwright.config.js`;

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

const listFlag = parseListFlag(process.argv.slice(2));
const { paths, extra } = splitArgs(listFlag.args);

if (listFlag.list) {
  const tests = collectFiles(sourceTestsDir, ".spec.ts");
  const entries = tests.map((file) => {
    const relSource = path.relative(sourceTestsDir, file).replaceAll("\\", "/");
    const rel = relSource.replace(/\.spec\.ts$/, "");
    const distPath = `${testsDir}/${relSource.replace(/\.spec\.ts$/, ".spec.js")}`;
    return {
      path: path.relative(repoRoot, distPath).replaceAll("\\", "/"),
      name: rel,
      safe_name: toSafeName(rel),
    };
  });
  console.log(JSON.stringify(entries));
  process.exit(0);
}

if (!fs.existsSync(testsDir)) {
  console.error(
    "Missing packages/core/dist/esm/tests/integration. Run pnpm run build:esm first.",
  );
  process.exit(1);
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

const coverageDir = initCoverageDir(
  resolveRepoRelative(
    process.env.NODE_V8_COVERAGE ??
      (relTestName
        ? `${repoRoot}/coverage/${useBrowserbase ? "e2e-bb" : "e2e-local"}/${relTestName}`
        : `${repoRoot}/coverage/${useBrowserbase ? "e2e-bb" : "e2e-local"}`),
  ),
);

const defaultJunitPath = relTestName
  ? `${repoRoot}/ctrf/${useBrowserbase ? "e2e-bb" : "e2e-local"}/${relTestName}.xml`
  : `${repoRoot}/ctrf/${useBrowserbase ? "e2e-bb" : "e2e-local"}/all.xml`;
const ctrfPath = initJunitPath(
  process.env.CTRF_JUNIT_PATH
    ? resolveRepoRelative(process.env.CTRF_JUNIT_PATH)
    : defaultJunitPath,
);

const baseNodeOptions = "--enable-source-maps";
const nodeOptions = [process.env.NODE_OPTIONS, baseNodeOptions]
  .filter(Boolean)
  .join(" ");

const env = withCtrfEnv(
  withCoverageEnv({ ...process.env, NODE_OPTIONS: nodeOptions }, coverageDir),
  ctrfPath,
);

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

maybeWriteCtrf(ctrfPath, writeCtrfFromJunit, "playwright");

process.exit(result.status ?? 1);

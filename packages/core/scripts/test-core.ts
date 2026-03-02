/**
 * Core unit tests (Vitest) on dist/esm tests.
 *
 * Prereqs: pnpm run build:esm (packages/core/dist/esm/tests/unit present).
 * Args: [test paths...] -- [vitest args...] | --list (prints JSON matrix)
 * Env: NODE_V8_COVERAGE, NODE_OPTIONS, VITEST_CONSOLE_REPORTER;
 *      writes CTRF to ctrf/vitest-core.xml by default.
 * Example: pnpm run test:core -- packages/core/dist/esm/tests/unit/foo.test.js -- --reporter=junit
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  ensureParentDir,
  parseListFlag,
  splitArgs,
  collectFiles,
  toSafeName,
  normalizeVitestArgs,
  findJunitPath,
  hasReporterName,
  writeCtrfFromJunit,
} from "./test-utils.js";
import { getRepoRootDir } from "../lib/v3/runtimePaths.js";

const repoRoot = getRepoRootDir();

const sourceTestsDir = `${repoRoot}/packages/core/tests/unit`;
const testsDir = `${repoRoot}/packages/core/dist/esm/tests/unit`;
const defaultConfigPath = `${repoRoot}/packages/core/vitest.esm.config.mjs`;

const resolveRepoRelative = (value: string) =>
  path.isAbsolute(value) ? value : path.resolve(repoRoot, value);

const hasConfigArg = (argsList: string[]) =>
  argsList.some((arg, i) => {
    if (arg.startsWith("--config=")) return true;
    return arg === "--config" && Boolean(argsList[i + 1]);
  });

const toTestName = (testPath: string) => {
  const abs = resolveRepoRelative(testPath);
  const rel = path.relative(testsDir, abs).replaceAll("\\", "/");
  if (!rel.startsWith("..")) {
    return rel.replace(/\.test\.(ts|js)$/i, "");
  }
  return path.basename(abs).replace(/\.test\.(ts|js)$/i, "");
};

const listFlag = parseListFlag(process.argv.slice(2));
const { paths, extra } = splitArgs(listFlag.args);

if (listFlag.list) {
  const tests = collectFiles(sourceTestsDir, ".test.ts");
  const entries = tests.map((file) => {
    const relSource = path.relative(sourceTestsDir, file).replaceAll("\\", "/");
    const rel = relSource.replace(/\.test\.ts$/, "");
    const distPath = `${testsDir}/${relSource.replace(/\.test\.ts$/, ".test.js")}`;
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
    "Missing packages/core/dist/esm/tests/unit. Run pnpm run build:esm first.",
  );
  process.exit(1);
}

const runtimePaths = paths.map(resolveRepoRelative);
const hasUserConfig = hasConfigArg(extra);

const baseNodeOptions = "--enable-source-maps";
const nodeOptions = [process.env.NODE_OPTIONS, baseNodeOptions]
  .filter(Boolean)
  .join(" ");

const relTestName = paths.length === 1 ? toTestName(paths[0]) : null;

const coverageDir = resolveRepoRelative(
  process.env.NODE_V8_COVERAGE ??
    (relTestName
      ? `${repoRoot}/coverage/core-unit/${relTestName}`
      : `${repoRoot}/coverage/core-unit`),
);
fs.mkdirSync(coverageDir, { recursive: true });

const normalizedExtra = normalizeVitestArgs(repoRoot, extra);
const defaultJunitPath = (() => {
  if (!relTestName) {
    return `${repoRoot}/ctrf/core-unit/all.xml`;
  }
  return `${repoRoot}/ctrf/core-unit/${relTestName}.xml`;
})();
const hasOutput = Boolean(findJunitPath(normalizedExtra));
const vitestArgs = [...normalizedExtra];
const consoleReporter = process.env.VITEST_CONSOLE_REPORTER ?? "default";
if (!hasReporterName(vitestArgs, consoleReporter)) {
  vitestArgs.push(`--reporter=${consoleReporter}`);
}
if (!hasReporterName(vitestArgs, "junit")) {
  vitestArgs.push("--reporter=junit");
}
if (!hasOutput) {
  ensureParentDir(defaultJunitPath);
  vitestArgs.push(`--outputFile.junit=${defaultJunitPath}`);
}
const junitPath = findJunitPath(vitestArgs) ?? defaultJunitPath;

const env = {
  ...process.env,
  NODE_OPTIONS: nodeOptions,
  NODE_V8_COVERAGE: coverageDir,
};

const result = spawnSync(
  "pnpm",
  [
    "--filter",
    "@browserbasehq/stagehand",
    "exec",
    "vitest",
    "run",
    ...(hasUserConfig ? [] : ["--config", defaultConfigPath]),
    ...vitestArgs,
    ...runtimePaths,
  ],
  { stdio: "inherit", env },
);

writeCtrfFromJunit(junitPath, "vitest");

process.exit(result.status ?? 1);

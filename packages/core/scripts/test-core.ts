/**
 * Core unit tests (Vitest) on dist/esm.
 *
 * Prereqs: pnpm run build (dist/esm present).
 * Args: [test paths...] -- [vitest args...] | --list (prints JSON matrix)
 * Env: NODE_V8_COVERAGE, NODE_OPTIONS, VITEST_CONSOLE_REPORTER;
 *      writes CTRF to ctrf/vitest-core.xml by default.
 * Example: pnpm run test:core -- packages/core/tests/foo.test.ts -- --reporter=junit
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import normalizeV8Coverage from "./normalize-v8-coverage";
import {
  findRepoRoot,
  resolveFromRoot,
  ensureParentDir,
  parseListFlag,
  splitArgs,
  collectFiles,
  toSafeName,
  normalizeVitestArgs,
  findJunitPath,
  hasReporterName,
  writeCtrfFromJunit,
} from "./test-utils";

const repoRoot = findRepoRoot(process.cwd());
const listFlag = parseListFlag(process.argv.slice(2));
const { paths, extra } = splitArgs(listFlag.args);

if (listFlag.list) {
  const root = path.join(repoRoot, "packages", "core", "tests");
  const tests = collectFiles(root, ".test.ts");
  const entries = tests.map((file) => {
    const rel = path.relative(root, file).replace(/\.test\.ts$/, "");
    return {
      path: path.relative(repoRoot, file),
      name: rel,
      safe_name: toSafeName(rel),
    };
  });
  console.log(JSON.stringify(entries));
  process.exit(0);
}

const distRoot = path.join(repoRoot, "packages", "core", "dist", "esm");
if (!fs.existsSync(distRoot)) {
  console.error("Missing packages/core/dist/esm. Run pnpm run build first.");
  process.exit(1);
}

const toDistPath = (testPath: string) => {
  if (
    testPath.endsWith(".js") &&
    testPath.includes(`${path.sep}dist${path.sep}esm${path.sep}`)
  ) {
    return testPath;
  }
  const abs = path.isAbsolute(testPath)
    ? testPath
    : path.resolve(repoRoot, testPath);
  const rel = path.relative(path.join(repoRoot, "packages", "core"), abs);
  return path
    .join(repoRoot, "packages", "core", "dist", "esm", rel)
    .replace(/\.ts$/i, ".js");
};

const compiledPaths = paths.map(toDistPath);

const baseNodeOptions = "--enable-source-maps";
const nodeOptions = [process.env.NODE_OPTIONS, baseNodeOptions]
  .filter(Boolean)
  .join(" ");

const testRoot = path.join(repoRoot, "packages", "core", "tests");
const relTestName =
  paths.length === 1
    ? (() => {
        const abs = path.isAbsolute(paths[0])
          ? paths[0]
          : path.resolve(repoRoot, paths[0]);
        const rel = path
          .relative(testRoot, abs)
          .replace(/\.test\.ts$/, "")
          .replace(/\.js$/, "");
        return rel && !rel.startsWith("..") ? rel : null;
      })()
    : null;

const coverageDir = resolveFromRoot(
  repoRoot,
  process.env.NODE_V8_COVERAGE ??
    (relTestName
      ? path.join(repoRoot, "coverage", "core-unit", relTestName)
      : path.join(repoRoot, "coverage", "core-unit")),
);
fs.mkdirSync(coverageDir, { recursive: true });
const normalizedExtra = normalizeVitestArgs(repoRoot, extra);
const defaultJunitPath = (() => {
  if (!relTestName) {
    return path.join(repoRoot, "ctrf", "core-unit", "all.xml");
  }
  return path.join(repoRoot, "ctrf", "core-unit", `${relTestName}.xml`);
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
    "--config",
    path.join(repoRoot, "packages", "core", "vitest.esm.config.mjs"),
    ...vitestArgs,
    ...compiledPaths,
  ],
  { stdio: "inherit", env },
);

if (coverageDir) {
  await normalizeV8Coverage(coverageDir);
}

writeCtrfFromJunit(junitPath, "vitest");

process.exit(result.status ?? 1);

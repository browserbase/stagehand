/**
 * E2E tests (Playwright) on dist/esm.
 *
 * Prereqs: pnpm run build (dist/esm present), Playwright deps installed.
 * Args: [test paths...] -- [playwright args...] | --list (prints JSON matrix)
 * Env: STAGEHAND_BROWSER_TARGET=local|browserbase, CHROME_PATH (local),
 *      NODE_V8_COVERAGE, PLAYWRIGHT_CONSOLE_REPORTER;
 *      writes CTRF to ctrf/playwright-*.xml by default.
 * Example: STAGEHAND_BROWSER_TARGET=browserbase pnpm run test:e2e -- lib/v3/tests/foo.spec.ts
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
  writeCtrfFromJunit,
} from "./test-utils";

const repoRoot = findRepoRoot(process.cwd());
const listFlag = parseListFlag(process.argv.slice(2));
const { paths, extra } = splitArgs(listFlag.args);
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
const { filtered: extraArgs, removed: removedReporterOverride } =
  stripReporterArgs(extra);
if (removedReporterOverride) {
  console.warn(
    "Ignoring Playwright --reporter override to preserve console + JUnit output.",
  );
}

if (listFlag.list) {
  const root = path.join(repoRoot, "packages", "core", "lib", "v3", "tests");
  const tests = collectFiles(root, ".spec.ts");
  const entries = tests.map((file) => {
    const rel = path.relative(root, file).replace(/\.spec\.ts$/, "");
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

const target = (process.env.STAGEHAND_BROWSER_TARGET ?? "local").toLowerCase();
const useBrowserbase = target === "browserbase";
const configPath = path.join(
  distRoot,
  "lib",
  "v3",
  "tests",
  "v3.playwright.config.js",
);
if (!fs.existsSync(configPath)) {
  console.error(`Missing Playwright config at ${configPath}.`);
  process.exit(1);
}

const coreRoot = path.join(repoRoot, "packages", "core");
const escapeRegex = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const toPlaywrightFilter = (testPath: string) => {
  const absolute = path.isAbsolute(testPath)
    ? testPath
    : path.resolve(repoRoot, testPath);
  const relFromCore = path.relative(coreRoot, absolute).replace(/\\/g, "/");
  const relFromDist = path.relative(distRoot, absolute).replace(/\\/g, "/");
  const candidates = [relFromCore, relFromDist, path.basename(absolute)].filter(
    (candidate) => candidate && !candidate.startsWith(".."),
  );
  const preferred =
    candidates.find((candidate) => candidate.startsWith("lib/v3/tests/")) ??
    candidates[0] ??
    testPath.replace(/\\/g, "/");
  const sourceMappedPath = preferred.endsWith(".spec.js")
    ? `${preferred.slice(0, -".spec.js".length)}.spec.ts`
    : preferred;
  return `${escapeRegex(sourceMappedPath)}$`;
};

const playwrightFilters = paths.map(toPlaywrightFilter);

const registerPath = path.join(
  repoRoot,
  "packages",
  "core",
  "scripts",
  "register-stagehand-dist.js",
);
const baseNodeOptions = [
  "--enable-source-maps",
  "--experimental-specifier-resolution=node",
  `--import ${registerPath}`,
].join(" ");
const nodeOptions = [process.env.NODE_OPTIONS, baseNodeOptions]
  .filter(Boolean)
  .join(" ");

const testRoot = path.join(repoRoot, "packages", "core", "lib", "v3", "tests");
const relTestName =
  paths.length === 1
    ? (() => {
        const abs = path.isAbsolute(paths[0])
          ? paths[0]
          : path.resolve(repoRoot, paths[0]);
        const rel = path
          .relative(testRoot, abs)
          .replace(/\.spec\.ts$/, "")
          .replace(/\.js$/, "");
        return rel && !rel.startsWith("..") ? rel : null;
      })()
    : null;

const coverageDir = resolveFromRoot(
  repoRoot,
  process.env.NODE_V8_COVERAGE ??
    (relTestName
      ? path.join(
          repoRoot,
          "coverage",
          useBrowserbase ? "e2e-bb" : "e2e-local",
          relTestName,
        )
      : path.join(
          repoRoot,
          "coverage",
          useBrowserbase ? "e2e-bb" : "e2e-local",
        )),
);
fs.mkdirSync(coverageDir, { recursive: true });
const defaultJunitPath = (() => {
  const baseDir = path.join(
    repoRoot,
    "ctrf",
    useBrowserbase ? "e2e-bb" : "e2e-local",
  );
  if (!relTestName) {
    return path.join(baseDir, "all.xml");
  }
  return path.join(baseDir, `${relTestName}.xml`);
})();
const ctrfPath = process.env.CTRF_JUNIT_PATH
  ? resolveFromRoot(repoRoot, process.env.CTRF_JUNIT_PATH)
  : defaultJunitPath;
if (ctrfPath) {
  ensureParentDir(ctrfPath);
}

const env = {
  ...process.env,
  NODE_OPTIONS: nodeOptions,
  NODE_V8_COVERAGE: coverageDir,
  CTRF_JUNIT_PATH: ctrfPath,
};

const result = spawnSync(
  "pnpm",
  [
    "--filter",
    "@browserbasehq/stagehand",
    "exec",
    "playwright",
    "test",
    "--config",
    configPath,
    ...extraArgs,
    ...playwrightFilters,
  ],
  { stdio: "inherit", env },
);

if (coverageDir) {
  await normalizeV8Coverage(coverageDir);
}

writeCtrfFromJunit(ctrfPath, "playwright");

process.exit(result.status ?? 1);

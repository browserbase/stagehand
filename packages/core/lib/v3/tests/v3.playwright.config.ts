import { defineConfig, type ReporterDescription } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const resolveRepoRoot = (startDir: string): string => {
  let current = path.resolve(startDir);
  while (true) {
    if (fs.existsSync(path.join(current, "pnpm-workspace.yaml"))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return startDir;
    }
    current = parent;
  }
};

const repoRoot = resolveRepoRoot(process.cwd());
const distTestDir = path.join(
  repoRoot,
  "packages",
  "core",
  "dist",
  "esm",
  "lib",
  "v3",
  "tests",
);
const srcTestDir = path.join(
  repoRoot,
  "packages",
  "core",
  "lib",
  "v3",
  "tests",
);
const testDir = fs.existsSync(distTestDir) ? distTestDir : srcTestDir;

const browserTarget = (
  process.env.STAGEHAND_BROWSER_TARGET ?? "local"
).toLowerCase();
const isBrowserbase = browserTarget === "browserbase";
const consoleReporter = process.env.PLAYWRIGHT_CONSOLE_REPORTER ?? "list";

const localWorkerOverride = Number(
  process.env.LOCAL_SESSION_LIMIT_PER_E2E_TEST,
);
const localWorkers =
  Number.isFinite(localWorkerOverride) && localWorkerOverride > 0
    ? localWorkerOverride
    : process.env.CI
      ? 3
      : 5;

const ciWorkerOverride = Number(
  process.env.BROWSERBASE_SESSION_LIMIT_PER_E2E_TEST,
);
const bbWorkers =
  process.env.CI && Number.isFinite(ciWorkerOverride) && ciWorkerOverride > 0
    ? ciWorkerOverride
    : 3;

const ctrfJunitPath = process.env.CTRF_JUNIT_PATH;
const envReporterPath = (() => {
  const distPath = path.join(
    repoRoot,
    "packages",
    "core",
    "dist",
    "esm",
    "lib",
    "v3",
    "tests",
    "envReporter.js",
  );
  if (fs.existsSync(distPath)) return distPath;
  return path.join(
    repoRoot,
    "packages",
    "core",
    "lib",
    "v3",
    "tests",
    "envReporter.ts",
  );
})();
const reporter: ReporterDescription[] = ctrfJunitPath
  ? [
      [consoleReporter],
      [envReporterPath],
      ["junit", { outputFile: ctrfJunitPath, includeProjectInTestName: true }],
    ]
  : [[consoleReporter], [envReporterPath]];

export default defineConfig({
  testDir,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  retries: process.env.CI ? 1 : 0,
  workers: isBrowserbase ? bbWorkers : localWorkers,
  fullyParallel: true,
  projects: [
    {
      name: isBrowserbase ? "e2e-bb" : "e2e-local",
    },
  ],
  reporter,
  use: {
    // we're not launching Playwright browsers in these tests; we connect via Puppeteer/CDP to V3.
    headless: false,
  },
});

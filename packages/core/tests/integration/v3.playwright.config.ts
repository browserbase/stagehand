import { defineConfig, type ReporterDescription } from "@playwright/test";
import { getPackageRootDir } from "../../lib/v3/runtimePaths.js";
const coreDir = getPackageRootDir();
const testDir = `${coreDir}/dist/esm/tests/integration`;

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
const reporter: ReporterDescription[] = ctrfJunitPath
  ? [
      [consoleReporter] as ReporterDescription,
      [
        "junit",
        { outputFile: ctrfJunitPath, includeProjectInTestName: true },
      ] as ReporterDescription,
    ]
  : [[consoleReporter] as ReporterDescription];

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

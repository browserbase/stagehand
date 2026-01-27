import { defineConfig, type ReporterDescription } from "@playwright/test";
import dotenv from "dotenv";
import path from "path";

// Load environment variables before setting TEST_ENV
dotenv.config();

// Try loading from repo root (packages/core/lib/v3/tests -> repo root = 5 levels up)
const repoRootEnvPath = path.resolve(__dirname, "../../../../../.env");
dotenv.config({ path: repoRootEnvPath, override: false });

// Set TEST_ENV before tests run
process.env.TEST_ENV = "LOCAL";

const localWorkerOverride = Number(
  process.env.LOCAL_SESSION_LIMIT_PER_E2E_TEST,
);
const baseWorkerCount =
  Number.isFinite(localWorkerOverride) && localWorkerOverride > 0
    ? localWorkerOverride
    : process.env.CI
      ? 3
      : 5;

const ctrfJunitPath = process.env.CTRF_JUNIT_PATH;
const reporter: ReporterDescription[] = ctrfJunitPath
  ? [
      ["list"],
      ["junit", { outputFile: ctrfJunitPath, includeProjectInTestName: true }],
    ]
  : [["list"]];

export default defineConfig({
  testDir: ".",
  timeout: 90_000,
  expect: { timeout: 10_000 },
  retries: process.env.CI ? 1 : 0,
  // Balanced parallelization for local E2E runs (override via env if needed).
  workers: baseWorkerCount,
  fullyParallel: true,
  projects: [
    {
      name: "e2e-local",
    },
  ],
  reporter,
  use: {
    // we're not launching Playwright browsers in these tests; we connect via Puppeteer/CDP to V3.
    headless: false,
  },
});

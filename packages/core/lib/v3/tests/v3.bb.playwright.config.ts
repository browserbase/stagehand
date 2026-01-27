import { defineConfig, type ReporterDescription } from "@playwright/test";
import dotenv from "dotenv";
import path from "path";

// Load environment variables before setting STAGEHAND_ENV
dotenv.config();

// Try loading from repo root (packages/core/lib/v3/tests -> repo root = 5 levels up)
const repoRootEnvPath = path.resolve(__dirname, "../../../../../.env");
dotenv.config({ path: repoRootEnvPath, override: false });

// Set STAGEHAND_ENV before tests run
process.env.STAGEHAND_ENV = "BROWSERBASE";

const ciWorkerOverride = Number(
  process.env.BROWSERBASE_SESSION_LIMIT_PER_E2E_TEST,
);
const workerCount =
  process.env.CI && Number.isFinite(ciWorkerOverride) && ciWorkerOverride > 0
    ? ciWorkerOverride
    : 3;

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
  // Conservative parallelization for Browserbase in CI (override via env if needed).
  // Browserbase tests are heavier due to remote browser connections.
  workers: workerCount,
  fullyParallel: true,
  projects: [
    {
      name: "e2e-bb",
    },
  ],
  reporter,
  use: {
    headless: false,
  },
});

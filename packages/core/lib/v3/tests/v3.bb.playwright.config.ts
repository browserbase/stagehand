import { defineConfig, type ReporterDescription } from "@playwright/test";
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";

// Load environment variables before setting STAGEHAND_ENV
dotenv.config();

const resolveRepoRoot = (startDir: string): string => {
  let current = startDir;
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
const srcTestDir = path.join(repoRoot, "packages", "core", "lib", "v3", "tests");
const testDir = fs.existsSync(distTestDir) ? distTestDir : srcTestDir;

// Try loading from repo root without assuming dist vs src layout.
const repoRootEnvPath = path.join(repoRoot, ".env");
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
      ["list"],
      [envReporterPath],
      ["junit", { outputFile: ctrfJunitPath, includeProjectInTestName: true }],
    ]
  : [["list"], [envReporterPath]];

export default defineConfig({
  testDir,
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

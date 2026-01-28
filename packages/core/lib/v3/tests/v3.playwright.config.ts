import { defineConfig, type ReporterDescription } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

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
  ? [["list"], [envReporterPath], ["junit", { outputFile: ctrfJunitPath }]]
  : [["list"], [envReporterPath]];

export default defineConfig({
  testDir: ".",
  timeout: 90_000,
  expect: { timeout: 10_000 },
  // Increased from 2 to improve CI performance. Use environment variable to control.
  // CI uses 4 workers, local development can use up to 8 for faster test runs.
  workers: process.env.CI ? 4 : 6,
  fullyParallel: true,
  reporter,
  use: {
    // we're not launching Playwright browsers in these tests; we connect via Puppeteer/CDP to V3.
    headless: false,
  },
});

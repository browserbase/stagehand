import { defineConfig, type ReporterDescription } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const findCoreDir = (startDir: string): string => {
  let current = path.resolve(startDir);
  while (true) {
    const nestedCorePath = path.join(
      current,
      "packages",
      "core",
      "package.json",
    );
    if (fs.existsSync(nestedCorePath)) {
      try {
        const nestedPkg = JSON.parse(
          fs.readFileSync(nestedCorePath, "utf8"),
        ) as {
          name?: string;
        };
        if (nestedPkg.name === "@browserbasehq/stagehand") {
          return path.join(current, "packages", "core");
        }
      } catch {
        // keep climbing until we find the core package root
      }
    }

    const packageJsonPath = path.join(current, "package.json");
    if (fs.existsSync(packageJsonPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as {
          name?: string;
        };
        if (pkg.name === "@browserbasehq/stagehand") {
          return current;
        }
      } catch {
        // keep climbing until we find the core package root
      }
    }

    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error(
        `Unable to find @browserbasehq/stagehand from ${startDir}`,
      );
    }
    current = parent;
  }
};

const coreDir = findCoreDir(process.cwd());
const testDir = path.join(coreDir, "dist", "esm", "tests", "integration");

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

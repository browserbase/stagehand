import { defineConfig } from "@playwright/test";
import dotenv from "dotenv";
import path from "path";

// Load environment variables before setting TEST_ENV
dotenv.config();

// Try loading from repo root (packages/core/lib/v3/tests -> repo root = 5 levels up)
const repoRootEnvPath = path.resolve(__dirname, "../../../../../.env");
dotenv.config({ path: repoRootEnvPath, override: false });

// Set TEST_ENV before tests run
process.env.TEST_ENV = "BROWSERBASE";

export default defineConfig({
  testDir: ".",
  timeout: 90_000,
  expect: { timeout: 10_000 },
  // Conservative parallelization for Browserbase: 2 workers in CI to avoid resource exhaustion.
  // Browserbase tests are heavier due to remote browser connections.
  workers: process.env.CI ? 2 : 3,
  fullyParallel: true,
  reporter: "list",
  use: {
    headless: false,
  },
});

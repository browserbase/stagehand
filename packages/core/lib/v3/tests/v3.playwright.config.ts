import { defineConfig } from "@playwright/test";
import dotenv from "dotenv";
import path from "path";

// Load environment variables so agent-streaming tests can reach Anthropic in CI
dotenv.config();
const repoRootEnvPath = path.resolve(__dirname, "../../../../../.env");
dotenv.config({ path: repoRootEnvPath, override: false });

if (!process.env.TEST_ENV) {
  process.env.TEST_ENV = "LOCAL";
}

export default defineConfig({
  testDir: ".",
  timeout: 90_000,
  expect: { timeout: 10_000 },
  // Increased from 2 to improve CI performance. Use environment variable to control.
  // CI uses 4 workers, local development can use up to 8 for faster test runs.
  workers: process.env.CI ? 4 : 6,
  fullyParallel: true,
  reporter: "list",
  use: {
    // we're not launching Playwright browsers in these tests; we connect via Puppeteer/CDP to V3.
    headless: false,
  },
});

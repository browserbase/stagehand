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
  workers: process.env.CI ? 3 : 4,
  fullyParallel: true,
  reporter: "list",
  use: {
    headless: false,
  },
});

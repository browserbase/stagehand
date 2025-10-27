import { defineConfig } from "@playwright/test";

// Set TEST_ENV before tests run
process.env.TEST_ENV = "BROWSERBASE";

export default defineConfig({
  testDir: ".",
  timeout: 90_000,
  expect: { timeout: 10_000 },
  workers: 2,
  fullyParallel: true,
  reporter: "list",
  use: {
    headless: false,
  },
});

import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  timeout: 90_000,
  expect: { timeout: 10_000 },
  // Keep single-worker until the suite is stable; parallel browsers can clash with a single V3 instance.
  workers: 2,
  fullyParallel: true,
  reporter: "list",
  use: {
    // we're not launching Playwright browsers in these tests; we connect via Puppeteer/CDP to V3.
    headless: false,
  },
});

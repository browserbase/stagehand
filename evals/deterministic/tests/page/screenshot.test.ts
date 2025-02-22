import { test, expect } from "@playwright/test";
import { Stagehand } from "@/dist";
import StagehandConfig from "@/evals/deterministic/stagehand.config";
import path from "path";
import fs from "fs";

test.describe("StagehandPage - Screenshot", () => {
  let stagehand: Stagehand;

  test.beforeAll(async () => {
    stagehand = new Stagehand(StagehandConfig);
    await stagehand.init();
  });

  test.afterAll(async () => {
    await stagehand.close();
  });

  test("should take a basic screenshot", async () => {
    const { page } = stagehand;
    await page.goto("https://example.com");

    const screenshotPath = path.join("downloads", `screenshot-${Date.now()}.png`);
    await page.screenshot({
      path: screenshotPath,
    });

    expect(fs.existsSync(screenshotPath)).toBeTruthy();
    expect(path.extname(screenshotPath)).toBe(".png");

    // Cleanup
    fs.unlinkSync(screenshotPath);
  });

  test("should take a full page JPEG screenshot with custom quality", async () => {
    const { page } = stagehand;
    await page.goto("https://example.com");

    const screenshotPath = path.join("downloads", "custom-screenshot.jpg");
    await page.screenshot({
      path: screenshotPath,
      fullPage: true,
      type: "jpeg",
      quality: 80,
    });

    expect(fs.existsSync(screenshotPath)).toBeTruthy();
    expect(path.extname(screenshotPath)).toBe(".jpg");

    // Get file stats to verify it's a valid image
    const stats = fs.statSync(screenshotPath);
    expect(stats.size).toBeGreaterThan(0);

    // Cleanup
    fs.unlinkSync(screenshotPath);
  });

  test("should save screenshot in configured downloads directory", async () => {
    const customDownloadsPath = "custom-downloads";
    const stagehandWithCustomDownloads = new Stagehand({
      ...StagehandConfig,
      localBrowserLaunchOptions: {
        ...StagehandConfig.localBrowserLaunchOptions,
        downloadsPath: customDownloadsPath,
      },
    });
    await stagehandWithCustomDownloads.init();

    const { page } = stagehandWithCustomDownloads;
    await page.goto("https://example.com");

    const screenshotPath = path.join(customDownloadsPath, `screenshot-${Date.now()}.png`);
    await page.screenshot({
      path: screenshotPath,
    });

    expect(screenshotPath.startsWith(customDownloadsPath)).toBeTruthy();
    expect(fs.existsSync(screenshotPath)).toBeTruthy();

    // Cleanup
    fs.unlinkSync(screenshotPath);
    fs.rmdirSync(customDownloadsPath);

    await stagehandWithCustomDownloads.close();
  });
});

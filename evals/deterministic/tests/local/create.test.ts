import { test, expect } from "@playwright/test";
import { Stagehand } from "@browserbasehq/stagehand";
import path from "path";
import fs from "fs";
import os from "os";
import type { Cookie } from "@playwright/test";
import StagehandConfig from "../../stagehand.config";

test.describe("Local browser launch options", () => {
  test("launches with default options when no localBrowserLaunchOptions provided", async () => {
    const stagehand = new Stagehand(StagehandConfig);
    await stagehand.init();

    const context = stagehand.context;
    expect(context.browser()).toBeDefined();
    expect(context.pages().length).toBe(1);

    await stagehand.close();
  });

  test("respects custom userDataDir", async () => {
    const customUserDataDir = path.join(os.tmpdir(), "custom-user-data");

    const stagehand = new Stagehand({
      ...StagehandConfig,
      localBrowserLaunchOptions: {
        userDataDir: customUserDataDir,
        headless: true,
        preserveUserDataDir: true,
      },
    });
    await stagehand.init();

    expect(fs.existsSync(customUserDataDir)).toBeTruthy();

    await stagehand.close();

    expect(fs.existsSync(customUserDataDir)).toBeTruthy();

    // Cleanup
    fs.rmSync(customUserDataDir, { recursive: true, force: true });
  });

  test("cleans up userDataDir by default when preserveUserDataDir is false", async () => {
    const customUserDataDir = path.join(os.tmpdir(), "cleanup-user-data");

    const stagehand = new Stagehand({
      ...StagehandConfig,
      localBrowserLaunchOptions: {
        userDataDir: customUserDataDir,
        headless: true,
        preserveUserDataDir: false,
      },
    });
    await stagehand.init();

    expect(fs.existsSync(customUserDataDir)).toBeTruthy();

    await stagehand.close();

    expect(fs.existsSync(customUserDataDir)).toBeFalsy();
  });

  test("cleans up userDataDir by default when no preserveUserDataDir flag is provided", async () => {
    const customUserDataDir = path.join(
      os.tmpdir(),
      "default-cleanup-user-data",
    );

    const stagehand = new Stagehand({
      ...StagehandConfig,
      localBrowserLaunchOptions: {
        userDataDir: customUserDataDir,
        headless: true,
        // No preserveUserDataDir flag provided - should default to cleanup
      },
    });
    await stagehand.init();

    expect(fs.existsSync(customUserDataDir)).toBeTruthy();

    await stagehand.close();

    expect(fs.existsSync(customUserDataDir)).toBeFalsy();
  });

  test("applies custom viewport settings", async () => {
    const customViewport = { width: 1920, height: 1080 };

    const stagehand = new Stagehand({
      ...StagehandConfig,
      localBrowserLaunchOptions: {
        ...StagehandConfig.localBrowserLaunchOptions,
        viewport: customViewport,
      },
    });
    await stagehand.init();

    const page = await stagehand.context.newPage();
    const viewport = page.viewportSize();

    expect(viewport).toEqual(customViewport);

    await stagehand.close();
  });

  test("applies custom cookies", async () => {
    const testCookies: Cookie[] = [
      {
        name: "testCookie",
        value: "testValue",
        domain: "browserbase.github.io",
        path: "/",
        expires: -1,
        httpOnly: false,
        secure: false,
        sameSite: "Lax" as const,
      },
    ];

    const stagehand = new Stagehand({
      ...StagehandConfig,
      localBrowserLaunchOptions: {
        ...StagehandConfig.localBrowserLaunchOptions,
        cookies: testCookies,
      },
    });
    await stagehand.init();

    const page = await stagehand.context.newPage();
    await page.goto(
      "https://browserbase.github.io/stagehand-eval-sites/sites/example",
    );
    const cookies = await stagehand.context.cookies();

    expect(cookies[0]).toMatchObject(
      testCookies[0] as unknown as Record<string, unknown>,
    );

    await stagehand.close();
  });

  test("applies custom geolocation settings", async () => {
    const customGeolocation = {
      latitude: 40.7128,
      longitude: -74.006,
    };

    const stagehand = new Stagehand({
      ...StagehandConfig,
      localBrowserLaunchOptions: {
        ...StagehandConfig.localBrowserLaunchOptions,
        geolocation: customGeolocation,
        permissions: ["geolocation"],
      },
    });
    await stagehand.init();

    const page = await stagehand.context.newPage();
    await page.goto(
      "https://browserbase.github.io/stagehand-eval-sites/sites/example",
    );

    const location = await page.evaluate(() => {
      return new Promise((resolve) => {
        navigator.geolocation.getCurrentPosition(
          (position) => {
            resolve({
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
            });
          },
          () => resolve(null),
        );
      });
    });

    expect(location).toEqual(customGeolocation);

    await stagehand.close();
  });

  test("applies custom timezone and locale", async () => {
    const stagehand = new Stagehand({
      ...StagehandConfig,
      localBrowserLaunchOptions: {
        ...StagehandConfig.localBrowserLaunchOptions,
        locale: "ja-JP",
        timezoneId: "Asia/Tokyo",
      },
    });
    await stagehand.init();

    const page = await stagehand.context.newPage();
    await page.goto(
      "https://browserbase.github.io/stagehand-eval-sites/sites/example",
    );

    const { locale, timezone } = await page.evaluate(() => ({
      locale: navigator.language,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    }));

    expect(locale).toBe("ja-JP");
    expect(timezone).toBe("Asia/Tokyo");

    await stagehand.close();
  });

  test("records video when enabled", async () => {
    const videoDir = path.join(os.tmpdir(), "test-videos");
    fs.mkdirSync(videoDir, { recursive: true });

    const stagehand = new Stagehand({
      ...StagehandConfig,
      localBrowserLaunchOptions: {
        ...StagehandConfig.localBrowserLaunchOptions,
        recordVideo: {
          dir: videoDir,
          size: { width: 800, height: 600 },
        },
      },
    });
    await stagehand.init();

    const page = await stagehand.context.newPage();
    await page.goto(
      "https://browserbase.github.io/stagehand-eval-sites/sites/example",
    );
    await stagehand.close();

    const videos = fs.readdirSync(videoDir);
    expect(videos.length).toBeGreaterThan(0);
    expect(videos[0]).toMatch(/\.webm$/);

    // Cleanup
    fs.rmSync(videoDir, { recursive: true, force: true });
  });
});

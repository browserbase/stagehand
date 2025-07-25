import { expect, test } from "@playwright/test";
import StagehandConfig from "@/evals/deterministic/stagehand.config";
import { Stagehand } from "@browserbasehq/stagehand";
import { promises as fs } from "fs";
import path from "path";

test("Default download behaviour (local)", async () => {
  const downloadsDir: string = path.resolve(process.cwd(), "downloads");
  await fs.rm(downloadsDir, { recursive: true, force: true });
  await fs.mkdir(downloadsDir, { recursive: true });
  const stagehand = new Stagehand({
    ...StagehandConfig,
    env: "LOCAL",
  });
  await stagehand.init();
  const page = stagehand.page;
  await page.goto(
    "https://browserbase.github.io/stagehand-eval-sites/sites/download-on-click/",
  );

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("xpath=/html/body/button").click(),
  ]);
  if ((await download.failure()) !== null) {
    await stagehand.close();
    throw new Error("Local download reported a failure");
  }

  // Wait until Playwright has the real file path (guarantees it’s done)
  const downloadPath: string | null = await download.path();
  if (downloadPath === null) {
    await stagehand.close();
    throw new Error("Download completed, but path() returned null");
  }

  const expectedFileSize = 13_264; // bytes
  const suggested: string = download.suggestedFilename();
  const finalPath: string = path.join(downloadsDir, suggested);

  await expect
    .poll(
      async () => {
        try {
          const stat = await fs.stat(finalPath);
          return stat.isFile() && stat.size === expectedFileSize;
        } catch {
          return false;
        }
      },
      {
        message: `Expected "${suggested}" in ${downloadsDir}`,
        timeout: 10_000,
      },
    )
    .toBe(true);

  const { size } = await fs.stat(finalPath);
  expect(size).toBe(expectedFileSize);

  await stagehand.close();
});

const downloadRe = /sandstorm\.mp3/;

test("Downloads", async () => {
  const stagehand = new Stagehand({
    ...StagehandConfig,
    env: "LOCAL",
  });
  await stagehand.init();
  const page = stagehand.page;

  await page.goto("https://browser-tests-alpha.vercel.app/api/download-test");

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("#download").click(),
  ]);

  const downloadError = await download.failure();

  if (downloadError !== null) {
    throw new Error(`Download failed: ${downloadError}`);
  }

  const suggestedFilename = download.suggestedFilename();
  const filePath = path.join(stagehand.downloadsPath, suggestedFilename);

  await stagehand.close();

  // Verify the download exists and matches expected pattern
  expect(
    await fs
      .access(filePath)
      .then(() => true)
      .catch(() => false),
  ).toBe(true);
  expect(suggestedFilename).toMatch(downloadRe);

  // Verify file size
  const stats = await fs.stat(filePath);
  const expectedFileSize = 6137541;
  expect(stats.size).toBe(expectedFileSize);
});

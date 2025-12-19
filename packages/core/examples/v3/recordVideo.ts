import path from "node:path";
import { mkdir } from "node:fs/promises";
import { Stagehand } from "../../lib/v3";
import { chromium } from "playwright-core";
import { z } from "zod";

async function recordPlaywrightVideo(stagehand: Stagehand): Promise<void> {
  const browser = await chromium.connectOverCDP({
    wsEndpoint: stagehand.connectURL(),
  });

  const videoDir = path.resolve(process.cwd(), "artifacts", "stagehand-videos");
  await mkdir(videoDir, { recursive: true });

  const context = await browser.newContext({
    recordVideo: {
      dir: videoDir,
      size: { width: 1280, height: 720 },
    },
  });

  const page = await context.newPage();
  await page.goto("https://docs.stagehand.dev/first-steps/quickstart", {
    waitUntil: "domcontentloaded",
  });

  await stagehand.act("click the introduction div in the first steps section");

  const { primitives } = await stagehand.extract(
    "list the four Stagehand primitives that are described on the page",
    z.object({
      primitives: z.array(z.string()),
    }),
    { page },
  );

  console.log("Stagehand primitives:", primitives.join(", "));

  // Capture the handle before closing the context so we can read the video path afterwards.
  const video = page.video();

  await context.close();

  if (video) {
    const videoPath = await video.path();
    console.log(`Playwright saved the video to ${videoPath}`);
  } else {
    console.log("Video recording was not enabled for this context.");
  }
}

(async () => {
  const stagehand = new Stagehand({
    env: "LOCAL",
    verbose: 1,
    model: "google/gemini-2.5-flash",
  });

  try {
    await stagehand.init();
    await recordPlaywrightVideo(stagehand);
  } finally {
    await stagehand.close().catch(() => {});
  }
})();

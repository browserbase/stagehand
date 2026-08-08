import { localBrowser, Stagehand } from "../src/index.js";

const browser = await localBrowser.launch({ headless: false });

try {
  const stagehand = await Stagehand.create({ browser });

  try {
    const result = await stagehand.experimentalBatch(
      async ({ page }, input) => {
        await page.goto(input.url);
        return {
          title: await page.title(),
          heading: await page.locator("h1").innerText(),
        };
      },
      { url: "https://example.com" },
      { timeout: 30_000 },
    );

    console.log(result);
  } finally {
    await stagehand.close();
  }
} finally {
  await browser.close();
}

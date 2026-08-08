import { localBrowser, Stagehand } from "../src/index.js";

const browser = await localBrowser.launch({ headless: false });

try {
  const stagehand = await Stagehand.create({ browser });

  try {
    const result = await stagehand.experimentalBatch(
      async (batch, input) => {
        await batch.page.goto(input.url);
        return {
          title: await batch.page.title(),
          heading: await batch.page.locator("h1").innerText(),
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

// Stagehand + Browserbase: Basic Caching - See README.md for full documentation

import "dotenv/config";
import { browserbase, Stagehand } from "@browserbasehq/stagehand";

const INSTRUCTION = "Find the More information link";

async function main() {
  console.log("Starting Browserbase Cache demo...");

  const browser = await browserbase.launch({
    apiKey: process.env.BROWSERBASE_API_KEY!,
  });
  const stagehand = await Stagehand.create({
    browser,
    cache: { threshold: 1 },
    logging: { level: "error" },
  });

  try {
    const page = (await browser.context.pages())[0];
    await page.goto("https://example.com", { waitUntil: "domcontentloaded" });

    const firstStart = Date.now();
    const first = await stagehand.observe(INSTRUCTION);
    const firstMs = Date.now() - firstStart;
    if (first.data.length === 0) throw new Error("First observation returned no link");

    const secondStart = Date.now();
    const second = await stagehand.observe(INSTRUCTION);
    const secondMs = Date.now() - secondStart;
    if (second.data.length === 0) throw new Error("Cached observation returned no link");

    console.log(
      JSON.stringify(
        {
          first: { cache: first.metadata.cache.status, durationMs: firstMs },
          second: {
            cache: second.metadata.cache.status,
            durationMs: secondMs,
            tokensSaved: second.metadata.cache.tokensSaved ?? null,
          },
        },
        null,
        2,
      ),
    );

    if (second.metadata.cache.status !== "HIT") {
      throw new Error(
        `Expected the repeated observation to be a cache HIT, got ${second.metadata.cache.status}`,
      );
    }
    console.log("Cache verified: the repeated observation was served without inference.");
  } finally {
    await stagehand.close();
    await browser.close();
  }
}

main().catch((error) => {
  console.error("Error in caching demo:", error);
  console.error("Check BROWSERBASE_API_KEY and Browserbase Cache availability.");
  process.exit(1);
});

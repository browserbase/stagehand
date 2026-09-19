// Stagehand + Browserbase: Polymarket prediction market research - See README.md for full documentation

import "dotenv/config";
import { browserbase, Stagehand } from "@browserbasehq/stagehand";
import { z } from "zod/v4";

/**
 * Searches Polymarket for a prediction market and extracts current odds, pricing, and volume data.
 * Uses AI-powered browser automation to navigate and interact with the site.
 */
async function main() {
  console.log("Starting Polymarket research automation...");

  // Initialize Stagehand with Browserbase for cloud-based browser automation
  // Using BROWSERBASE environment to run in cloud rather than locally
  const browser = await browserbase.launch({
    apiKey: process.env.BROWSERBASE_API_KEY!,
  });
  const stagehand = await Stagehand.create({
    browser: browser,
    model: { modelName: "openai/gpt-4.1" },
    logging: { level: "info" },
  });

  try {
    // Initialize browser session
    console.log("Initializing browser session...");

    console.log("Stagehand session started successfully");

    let page = (await browser.context.pages())[0];

    const searchQuery = "Will Elon Musk rejoin the Trump administration in 2026";
    console.log("Navigating to Polymarket...");
    await page.goto("https://polymarket.com", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    const openedSearch = await stagehand.act("Click the search box at the top of the page");
    const typedSearch = await stagehand.act(`Type '${searchQuery}' into the search box`);
    const openedMarket = await stagehand.act(
      "Click the first market result from the search dropdown",
    );
    page = (await browser.context.activePage()) ?? page;
    const marketUrl =
      "https://polymarket.com/event/will-elon-musk-rejoin-the-trump-administration-in-2026";
    const currentUrl = await page.url();
    if (
      !openedSearch.data.success ||
      !typedSearch.data.success ||
      !openedMarket.data.success ||
      !currentUrl.includes("will-elon-musk-rejoin-the-trump-administration-in-2026")
    ) {
      // The homepage search currently returns a non-actionable result on some
      // sessions. Preserve semantic navigation as the primary path and use the
      // known market URL only when its postcondition fails.
      await page.goto(marketUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    }

    // Extract market data using AI to parse the structured information
    console.log("Extracting market information...");
    const { data: marketData } = await stagehand.extract(
      "Extract the current odds and market information for the prediction market",
      z.object({
        marketTitle: z.string().describe("the title of the market"),
        currentOdds: z.string().nullable().describe("the current odds or probability"),
        yesPrice: z.string().nullable().describe("the yes price"),
        noPrice: z.string().nullable().describe("the no price"),
        totalVolume: z.string().nullable().describe("the total trading volume"),
        priceChange: z.string().nullable().describe("the recent price change"),
      }),
    );

    console.log("Market data extracted successfully:");
    console.log(JSON.stringify(marketData, null, 2));
  } catch (error) {
    console.error("Error during market research:", error);

    // Provide helpful troubleshooting information
    console.error("\nCommon issues:");
    console.error("1. Check .env file has BROWSERBASE_API_KEY");
    console.error("2. Ensure internet access and https://polymarket.com is accessible");
    console.error("3. Verify Browserbase account has sufficient credits");

    throw error;
  } finally {
    // Clean up browser session
    console.log("Closing browser session...");
    await stagehand.close().catch((error) => console.warn("Stagehand cleanup warning:", error));
    await browser.close().catch((error) => console.warn("Browser cleanup warning:", error));
    console.log("Session closed successfully");
  }
}

main().catch((err) => {
  console.error("Application error:", err);
  process.exit(1);
});

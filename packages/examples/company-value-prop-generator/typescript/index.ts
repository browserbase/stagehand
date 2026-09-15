// Stagehand + Browserbase: Value Prop One-Liner Generator - See README.md for full documentation

import "dotenv/config";
import { browserbase, Stagehand } from "@browserbasehq/stagehand";
import { z } from "zod/v4";

// Domain to analyze - change this to target a different website
const targetDomain = "www.browserbase.com"; // Or extract from email: email.split("@")[1]

/**
 * Analyzes a website's landing page to generate a concise one-liner value proposition.
 * Extracts the value prop using Stagehand, then uses an LLM to format it into a short phrase starting with "your".
 */
async function generateOneLiner(domain: string): Promise<string> {
  const browser = await browserbase.launch({
    apiKey: process.env.BROWSERBASE_API_KEY!,
  });
  const stagehand = await Stagehand.create({
    browser: browser,
    model: { modelName: "openai/gpt-4.1" },
    logging: { level: "error" },
  });

  try {
    console.log("Stagehand initialized successfully!");
    const page = (await browser.context.pages())[0];

    // Navigate to domain
    console.log(`🌐 Navigating to https://${domain}...`);
    // 5min timeout to handle slow-loading sites or network issues
    await page.goto(`https://${domain}/`, {
      waitUntil: "domcontentloaded",
      timeout: 300000,
    });

    console.log(`✅ Successfully loaded ${domain}`);

    // Extract value proposition from landing page
    console.log(`📝 Extracting value proposition for ${domain}...`);
    const { data: valueProp } = await stagehand.extract(
      "extract the value proposition from the landing page",
      z.object({
        value_prop: z.string(),
      }),
    );

    console.log(`📊 Extracted value prop for ${domain}:`, valueProp.value_prop);

    // Generate the one-liner with a second V4 extraction. Including the first extraction
    // keeps the request grounded while Stagehand's configured model handles formatting.
    console.log(`🤖 Generating email one-liner for ${domain}...`);

    const { data: formatted } = await stagehand.extract(
      `Using the company's value proposition "${valueProp.value_prop}", write a unique English description that starts with "your", uses no quotes, avoids generic adjectives, and is no more than 9 words`,
      z.object({ one_liner: z.string() }),
    );

    const oneLiner = formatted.one_liner.trim();

    console.log(`✨ Generated one-liner for ${domain}:`, oneLiner);
    return oneLiner;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Generation failed for ${domain}: ${errorMessage}`);
    throw error;
  } finally {
    await stagehand.close();
    await browser.close();
    console.log("Session closed successfully");
  }
}

/**
 * Main entry point: generates a one-liner value proposition for the target domain.
 */
async function main() {
  console.log("Starting One-Liner Generator...");

  try {
    const oneLiner = await generateOneLiner(targetDomain);
    console.log("\n✅ Success!");
    console.log(`One-liner: ${oneLiner}`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`\n❌ Error: ${errorMessage}`);
    console.error("\nCommon issues:");
    console.error(
      "  - Check .env file has BROWSERBASE_API_KEY set (required for browser automation)",
    );
    console.error("  - Ensure the domain is accessible and not a placeholder/maintenance page");
    console.error("  - Verify internet connectivity and that the target site is reachable");
    console.error("Docs: https://docs.browserbase.com/stagehand");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

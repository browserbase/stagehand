import { Stagehand } from "../lib";
import { z } from "zod";

async function scrapeHackerNews() {
  console.log("🚀 Starting Hacker News scraper...");
  const stagehand = new Stagehand({
    env: "LOCAL",
    verbose: 2, // Maximum verbosity
    debugDom: true,
    enableCaching: false,
    modelName: "gpt-4o",
    headless: process.env.HEADLESS === "true",
    modelClientOptions: {
      apiKey: process.env.OPENAI_API_KEY,
    },
  });

  try {
    console.log("🌟 Initializing Stagehand...");
    await stagehand.init();

    console.log("🌐 Navigating to Hacker News...");
    await stagehand.page.goto("https://news.ycombinator.com");

    // Extract top article info
    const schema = z.object({
      title: z.string(),
      url: z.string(),
      points: z.string(),
      comments: z.string().optional(),
    });

    console.log("📊 Extracting top article information...");
    const topArticle = await stagehand.page.extract({
      instruction:
        "Extract the title, URL, points, and number of comments for the top (first) article on the page",
      schema,
      useVision: true,
    });

    // Log token usage for extraction
    if (topArticle._stagehandTokenUsage) {
      console.log(
        `\n\x1b[1mHN-ARTICLE-EXTRACT Token Usage:\x1b[0m
        \x1b[36mPrompt Tokens:     ${topArticle._stagehandTokenUsage.promptTokens.toString().padStart(6)}\x1b[0m
        \x1b[32mCompletion Tokens: ${topArticle._stagehandTokenUsage.completionTokens.toString().padStart(6)}\x1b[0m
        \x1b[33mTotal Tokens:      ${topArticle._stagehandTokenUsage.totalTokens.toString().padStart(6)}\x1b[0m`,
      );
    }

    console.log("\n📰 Top Article Details:", topArticle);
  } finally {
    await stagehand.close();
  }
}

// Run the script
scrapeHackerNews().catch(console.error);

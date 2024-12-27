import { Stagehand } from "../lib";
import { z } from "zod";

function logTokenUsage(
  functionName: string,
  entry: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  },
) {
  console.log(
    `\n\x1b[1m${functionName} Token Usage:\x1b[0m
    \x1b[36mPrompt Tokens:     ${entry.promptTokens.toString().padStart(6)}\x1b[0m
    \x1b[32mCompletion Tokens: ${entry.completionTokens.toString().padStart(6)}\x1b[0m
    \x1b[33mTotal Tokens:      ${entry.totalTokens.toString().padStart(6)}\x1b[0m`,
  );
}

async function scrapeHackerNews() {
  console.log("🚀 Starting Hacker News scraper...");
  const stagehand = new Stagehand({
    env: "LOCAL",
    verbose: 2, // Maximum verbosity
    debugDom: true,
    enableCaching: false,
    modelName: "gpt-4o",
    headless: false,
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
    const extractUsage = stagehand.getUsage();
    const extractEntry = extractUsage.find(
      (entry) => entry.functionName === "extract",
    );
    if (extractEntry) {
      logTokenUsage("HN-ARTICLE-EXTRACT", extractEntry);
    }

    console.log("\n📰 Top Article Details:", topArticle);

    // Visit the article
    console.log("\n🔗 Visiting article URL...");
    await stagehand.page.goto(topArticle.url);

    // Get article summary
    console.log("📝 Generating article summary...");
    const summaryResult = await stagehand.page.act({
      action: "Read the main content and provide a concise 3-sentence summary",
    });

    // Log token usage for summary
    const summaryUsage = stagehand.getUsage();
    const actEntry = summaryUsage.find((entry) => entry.functionName === "act");
    if (actEntry) {
      logTokenUsage("HN-ARTICLE-SUMMARY", actEntry);
    }

    console.log("\n📋 Summary:", summaryResult);

    // Log total token usage
    console.log("\n💰 Total Tokens Used:", stagehand.getTotalTokensUsed());
  } finally {
    await stagehand.close();
  }
}

// Run the script
scrapeHackerNews().catch(console.error);

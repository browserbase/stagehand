import { defineFn } from "@browserbasehq/sdk-functions";
import { chromium } from "playwright-core";
import { Stagehand } from "@browserbasehq/stagehand";
import { z } from "zod";

const parametersSchema = z.object({
  companyName: z.string().describe("The company name to search for news about"),
  apiKey: z.string().describe("The AI model API key"),
  model: z
    .string()
    .optional()
    .describe("The AI model to use (default: anthropic/claude-sonnet-4-20250514)"),
  maxSteps: z.number().optional().describe("Maximum steps for agent execution (default: 30)"),
});

defineFn(
  "company-news-finder",
  async (context, params) => {
    const { session } = context;
    const startTime = Date.now();

    try {
      console.log("Connecting to browser session:", session.id);
      console.log(`Searching for latest news about: ${params.companyName}`);

      // Connect to the browser instance
      const browser = await chromium.connectOverCDP(session.connectUrl);
      const browserContext = browser.contexts()[0]!;
      const page = browserContext.pages()[0]!;

      console.log("Navigating to Google...");
      await page.goto("https://www.google.com", { waitUntil: "domcontentloaded" });

      // Wait a moment for the page to fully load
      await page.waitForTimeout(1000);

      // Configure Stagehand to use the existing browser session
      const stagehand = new Stagehand({
        model: {
          modelName: params.model ?? "anthropic/claude-sonnet-4-20250514",
          apiKey: params.apiKey,
        },
        env: "LOCAL",
        localBrowserLaunchOptions: {
          cdpUrl: session.connectUrl,
        },
        experimental: true,
      });

      await stagehand.init();

      console.log("Stagehand initialized, searching for company news...");

      // Use Stagehand agent to search Google and analyze news
      const agent = stagehand.agent({
        mode: "hybrid",
        model: params.model ?? "anthropic/claude-sonnet-4-20250514",
        systemPrompt: `You are a helpful assistant that searches for company news and provides summaries.`,
      });

      const result = await agent.execute({
        instruction: `Search Google for "${params.companyName} latest news" and analyze the results.

        Steps:
        1. In the Google search box, type "${params.companyName} latest news" and submit the search
        2. Wait for the results to load
        3. Look at the top news articles (typically the first 5-10 results)
        4. Read the headlines, snippets, and sources
        5. Create a comprehensive summary of what's happening with ${params.companyName} based on the news headlines and snippets

        Return a JSON object with:
        - "summary": A 2-3 paragraph summary of the current situation and recent news about ${params.companyName}
        - "topLinks": An array of the top 5-7 news articles with "title", "url", and "source" fields

        Make the summary informative and capture the key themes and developments.`,
        maxSteps: params.maxSteps ?? 30,
      });

      console.log("Agent execution completed");

      // Strip screenshots/large data from actions to stay under 64KB result limit
      const agentResult = result as any;
      const actions = (agentResult?.actions ?? []).map((a: any) => {
        const { screenshot, ...rest } = a;
        return rest;
      });

      return {
        companyName: params.companyName,
        success: agentResult?.success ?? false,
        completed: agentResult?.completed ?? false,
        message: agentResult?.message ?? "",
        actions,
        sessionReplayUrl: `https://www.browserbase.com/sessions/${session.id}`,
        duration: Date.now() - startTime,
      };
    } catch (error) {
      console.error("Company news finder failed:", error);

      return {
        companyName: params.companyName,
        error: error instanceof Error ? error.message : String(error),
        sessionReplayUrl: `https://www.browserbase.com/sessions/${session.id}`,
        duration: Date.now() - startTime,
      };
    }
  },
  {
    parametersSchema,
    sessionConfig: {
      browserSettings: {
        advancedStealth: true,
      },
    },
  },
);

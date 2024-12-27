import { test, expect } from "@playwright/test";
import { z } from "zod";
import { Stagehand } from "../../../../lib";
import StagehandConfig from "../../stagehand.config";

function logTokenUsage(functionName: string, entry: { promptTokens: number, completionTokens: number, totalTokens: number }) {
  console.log(
    `\n\x1b[1m${functionName} Token Usage:\x1b[0m
    \x1b[36mPrompt Tokens:     ${entry.promptTokens.toString().padStart(6)}\x1b[0m
    \x1b[32mCompletion Tokens: ${entry.completionTokens.toString().padStart(6)}\x1b[0m
    \x1b[33mTotal Tokens:      ${entry.totalTokens.toString().padStart(6)}\x1b[0m`
  );
}

test.describe("Token Usage Tracking", () => {
  test.setTimeout(120000);

  let stagehand: Stagehand;

  test.beforeEach(async () => {
    stagehand = new Stagehand(StagehandConfig);
    await stagehand.init();
  });

  test.afterEach(async () => {
    await stagehand.close();
  });

  // E-commerce scenarios
  test("should track tokens when browsing Amazon product details", async () => {
    const page = stagehand.page;
    await page.goto("https://www.amazon.com/Hitchhikers-Guide-Galaxy-Douglas-Adams/dp/0345418913");
    
    // Extract product information
    const schema = z.object({
      productName: z.string(),
      price: z.string(),
      rating: z.string().optional(),
    });
    
    await page.extract<typeof schema>({
      instruction: "get the product name, current price, and rating from this product",
      schema,
      useVision: true
    });
    
    const usage = stagehand.getUsage();
    const extractEntry = usage.find(entry => entry.functionName === "extract");
    if (extractEntry) {
      logTokenUsage('AMAZON-PRODUCT-EXTRACT', extractEntry);
    }
  });

  // News website scenarios
  test("should track tokens when analyzing news articles", async () => {
    const page = stagehand.page;
    await page.goto("https://www.reuters.com");
    
    // Find and read main headline
    await page.act({ 
      action: "find the main headline article and summarize its key points in 3 sentences" 
    });
    
    const usage = stagehand.getUsage();
    const actEntry = usage.find(entry => entry.functionName === "act");
    if (actEntry) {
      logTokenUsage('REUTERS-SUMMARY-ACT', actEntry);
    }
  });

  // Technical data extraction
  test("should track tokens when parsing technical content", async () => {
    const page = stagehand.page;
    await page.goto("https://github.com/microsoft/TypeScript/blob/main/README.md");
    
    const schema = z.object({
      installationSteps: z.array(z.string()),
      requirements: z.array(z.string()),
      documentation: z.object({
        quickStart: z.string(),
        handbook: z.string().optional(),
        samples: z.array(z.string()).optional()
      })
    });
    
    await page.extract<typeof schema>({
      instruction: "extract the installation steps, requirements, and documentation information from the TypeScript README",
      schema,
      useVision: false
    });
    
    const usage = stagehand.getUsage();
    const extractEntry = usage.find(entry => entry.functionName === "extract");
    if (extractEntry) {
      logTokenUsage('GITHUB-README-EXTRACT', extractEntry);
    }
  });
});
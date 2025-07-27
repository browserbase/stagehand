/**
 * Example of using the AI SDK client with Stagehand
 *
 * This demonstrates how to use the AI SDK integration for web automation
 * with Anthropic's Claude models.
 */

import { Stagehand } from "../index";

async function runAISDKExample() {
  // Initialize Stagehand
  const stagehand = new Stagehand({
    env: "LOCAL", // or "BROWSERBASE" if using Browserbase
    modelName: "claude-sonnet-4-20250514", // Use Claude for Stagehand's LLM operations
  });

  try {
    // Initialize the browser
    await stagehand.init();

    // Navigate to a starting page
    await stagehand.page.goto("https://www.example.com");

    // Run an agent task using AI SDK with Claude
    const agent = stagehand.agent({
      provider: "anthropic", // Specify the provider
      model: "claude-sonnet-4-20250514", // This will use AI SDK
    });

    const result = await agent.execute({
      instruction:
        "sign me up for an sf library card using random info please sir",
      maxSteps: 3,
    });

    console.log("Agent Result:", result);

    // The AI SDK client will automatically:
    // 1. Use the think tool to plan the approach
    // 2. Use getText to understand the page content
    // 3. Take a screenshot using the screenshot tool
    // 4. Provide a description of what it sees
  } catch (error) {
    console.error("Error:", error);
  } finally {
    // Clean up
    await stagehand.close();
  }
}

// Run the example
if (require.main === module) {
  runAISDKExample().catch(console.error);
}

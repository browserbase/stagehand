import { Stagehand } from "@browserbasehq/stagehand";
import dotenv from "dotenv";
import path from "path";

// Load environment variables
dotenv.config({ path: path.join(__dirname, "../.env") });

async function runAISDKAgentExample() {
  const stagehand = new Stagehand({
    env: "LOCAL",
    modelName: "anthropic/claude-sonnet-4-20250514",
    apiKey: process.env.ANTHROPIC_API_KEY,
  });

  try {
    await stagehand.init();
    console.log("Stagehand initialized successfully");

    // Navigate to a starting page
    await stagehand.page.goto("https://example.com");
    console.log("Navigated to example.com");

    // Create an AI SDK agent using the cleaner API
    // No need to pass stagehand or page anymore!
    const agent = stagehand.aiSDKAgent({
      model: "claude-3-5-sonnet-20241022",
      apiKey: process.env.ANTHROPIC_API_KEY,
      instructions: `You are a helpful assistant that can use a web browser.
      You are currently on the following page: ${stagehand.page.url()}.
      Do not ask follow up questions, the user will trust your judgement.`,
    });

    console.log("\n=== Example 1: Basic Streaming ===");
    const { streamedText, stop } = await agent.execute({
      instruction: "What's on this page?",
    });

    // Stop after 2 seconds to demonstrate early termination
    setTimeout(() => {
      console.log("\n[Stopping stream early...]");
      stop();
    }, 2000);

    // Wait a bit to see the accumulated text
    await new Promise((resolve) => setTimeout(resolve, 2500));
    console.log("\nAccumulated text:", streamedText);

    console.log("\n=== Example 2: With Callbacks ===");
    await agent.execute({
      instruction: "Click on any link you find",
      maxSteps: 3,
      onToolCall: (toolName, args) => {
        console.log(`\n[Tool: ${toolName}]`, args);
      },
      onTextDelta: (text) => {
        process.stdout.write(text);
      },
    });

    console.log("\n\n=== Example 3: Wait for Complete Result ===");
    const result = await agent.execute({
      instruction: "Describe the current page",
    });

    // Wait for the complete text
    const finalText = await result.text;
    console.log("Final result:", finalText);
  } catch (error) {
    console.error("Error:", error);
  } finally {
    await stagehand.close();
    console.log("\nStagehand closed");
  }
}

// Run the example
if (require.main === module) {
  runAISDKAgentExample().catch(console.error);
}

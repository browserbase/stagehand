import { Stagehand, AISDKAgent } from "@browserbasehq/stagehand";
import dotenv from "dotenv";
import path from "path";

// Load environment variables
dotenv.config({ path: path.join(__dirname, "../.env") });

async function runStreamControlExample() {
  const stagehand = new Stagehand({
    env: "LOCAL",
    modelName: "anthropic/claude-sonnet-4-20250514",
    apiKey: process.env.ANTHROPIC_API_KEY,
  });

  try {
    await stagehand.init();
    console.log("Stagehand initialized successfully");

    // Navigate to a starting page
    await stagehand.page.goto("https://news.ycombinator.com");
    console.log("Navigated to Hacker News");

    // Create an AI SDK agent
    const agent = new AISDKAgent({
      stagehand,
      page: stagehand.page,
      modelName: "claude-3-5-sonnet-20241022",
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    console.log("\n=== Example 1: Stream with Stop Control ===");
    const { streamedText, stop, text } = await agent.execute({
      instruction: "Describe in detail all the stories on the page",
      maxSteps: 3,
      onToolCall: (toolName) => {
        console.log(`\n[Tool: ${toolName}]`);
      },
      onTextDelta: (delta) => {
        process.stdout.write(delta);
      },
      onStepFinish: (stepInfo) => {
        console.log("\nStep finished:", stepInfo.finishReason);
      },
    });

    //stop the stream after 3 seconds
    setTimeout(() => {
      console.log("\n\n[Stopping stream after 3 seconds...]");
      stop();
    }, 3000);
    //access the streamed text
    for await (const chunk of streamedText) {
      process.stdout.write(chunk);
    }
    //access the final text
    try {
      const finalText = await text;
      console.log("\n\n=== Final text length:", finalText.length);
    } catch {
      console.log("\n\n=== Stream was stopped");
    }
  } catch (error) {
    console.error("Error:", error);
  } finally {
    await stagehand.close();
    console.log("\n\nStagehand closed");
  }
}

if (require.main === module) {
  runStreamControlExample().catch(console.error);
}

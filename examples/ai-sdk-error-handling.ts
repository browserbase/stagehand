import { Stagehand } from "@browserbasehq/stagehand";
import dotenv from "dotenv";
import path from "path";

// Load environment variables
dotenv.config({ path: path.join(__dirname, "../.env") });

async function runErrorHandlingExample() {
  const stagehand = new Stagehand({
    env: "LOCAL",
    experimental: true,
  });

  try {
    await stagehand.init();
    console.log("Stagehand initialized successfully");

    await stagehand.page.goto("https://www.amazon.com");
    const agent = stagehand.agent({
      provider: "aisdk",
      model: "anthropic/claude-sonnet-4-20250514",
      options: {
        apiKey: process.env.ANTHROPIC_API_KEY,
      },
    });

    const { streamedText, text } = await agent.execute({
      instruction: "order me shampoo from amazon using random info ",
      maxSteps: 15,
      onError: (error) => {
        console.error("Error message:", error);
      },
      onToolCall: (toolName, args) => {
        console.log(`Tool: ${toolName}, Args: ${JSON.stringify(args)}`);
      },
      onTextDelta: (text) => {
        console.log(text);
      },
      onStepFinish: (stepInfo) => {
        console.log(stepInfo);
      },
      onFinish: (result) => {
        console.log(result);
      },
    });

    //stop the stream

    //stream the text
    for (const chunk of streamedText) {
      console.log(chunk);
    }
    //get the final text
    const finalText = await text;
    console.log("\n\nFinal result:", finalText);
  } catch (error) {
    console.error("\n Fatal error:", error);
  } finally {
    await stagehand.close();
    console.log("\n\nStagehand closed");
  }
}

if (require.main === module) {
  runErrorHandlingExample().catch(console.error);
}

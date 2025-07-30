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

    const { text, messages } = await agent.execute({
      instruction: "order me shampoo from amazon using random info ",
      maxSteps: 5,
      onError: (error) => {
        console.error("Error message:", error);
      },
      onToolCall: (toolName, args) => {
        console.log(`Tool: ${toolName}, Args: ${JSON.stringify(args)}`);
      },
      onStepFinish: (stepInfo) => {
        console.log("stepInfo", stepInfo);
      },
      onFinish: (result) => {
        console.log("finish result", result);
      },
    });
    const chatMessages = await messages;
    console.log("chatMessages: first execution finished", chatMessages);
    console.log("starting second execution");
    const {
      streamedText: streamedText2,
      text: text2,
      messages: messages2,
    } = await agent.execute({
      instruction: "continue bro",
      messages: chatMessages,
      maxSteps: 5,
      onError: (error) => {
        console.error("Error message:", error);
      },
      onToolCall: (toolName, args) => {
        console.log(`Tool: ${toolName}, Args: ${JSON.stringify(args)}`);
      },
      onStepFinish: (stepInfo) => {
        console.log("stepInfo", stepInfo);
      },
      onFinish: (result) => {
        console.log("finish result", result);
      },
    });
    // Wait for the second execution to complete
    const finalText2 = await text2;
    const finalMessages2 = await messages2;

    console.log("streamedText2:", streamedText2);
    console.log("finalText2:", finalText2);
    console.log("Second execution messages count:", finalMessages2.length);
    console.log("\n\nSecond execution completed successfully");

    // Also wait for first execution text if needed
    const finalText = await text;
    console.log("\n\nFirst execution final text:", finalText);
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

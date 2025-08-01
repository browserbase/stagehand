import { Stagehand } from "@browserbasehq/stagehand";
import dotenv from "dotenv";
import path from "path";
import type { StepResult, ToolSet, CoreMessage } from "ai";

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
    const agent = await stagehand.agent({
      provider: "aisdk",
      model: "anthropic/claude-sonnet-4-20250514",
      options: {
        apiKey: process.env.ANTHROPIC_API_KEY,
      },
    });

    const result = await agent.execute({
      instruction: "order me shampoo from amazon using random info ",
      maxSteps: 5,
      onError: (event: { error: unknown }) => {
        console.error("Error message:", event.error);
      },
      onToolCall: (toolName: string, args: unknown) => {
        console.log(`Tool: ${toolName}, Args: ${JSON.stringify(args)}`);
      },
      onStepFinish: (stepInfo: StepResult<ToolSet>) => {
        console.log("stepInfo", stepInfo);
      },
      onFinish: (
        result: Omit<StepResult<ToolSet>, "stepType" | "isContinued"> & {
          steps: StepResult<ToolSet>[];
          messages: CoreMessage[];
        },
      ) => {
        console.log("finish result", result);
      },
    });

    // Wait for the promises to resolve
    const text = await result.text;
    const messages = await result.messages;
    console.log("chatMessages: first execution finished", messages);
    console.log("starting second execution");

    const result2 = await agent.execute({
      instruction: "continue bro",
      messages: messages,
      maxSteps: 5,
      onError: (event: { error: unknown }) => {
        console.error("Error message:", event.error);
      },
      onToolCall: (toolName: string, args: unknown) => {
        console.log(`Tool: ${toolName}, Args: ${JSON.stringify(args)}`);
      },
      onStepFinish: (stepInfo: StepResult<ToolSet>) => {
        console.log("stepInfo", stepInfo);
      },
      onFinish: (
        result: Omit<StepResult<ToolSet>, "stepType" | "isContinued"> & {
          steps: StepResult<ToolSet>[];
          messages: CoreMessage[];
        },
      ) => {
        console.log("finish result", result);
      },
    });

    // Wait for the second execution to complete
    const finalText2 = await result2.text;
    const finalMessages2 = await result2.messages;

    console.log("streamedText2:", result2.streamedText);
    console.log("finalText2:", finalText2);
    console.log("Second execution messages count:", finalMessages2.length);
    console.log("\n\nSecond execution completed successfully");

    // Also log first execution text
    console.log("\n\nFirst execution final text:", text);
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

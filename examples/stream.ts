/* eslint-disable @typescript-eslint/no-unused-vars */
import { Stagehand } from "@browserbasehq/stagehand";
import StagehandConfig from "../stagehand.config";

async function main() {
  const stagehand = new Stagehand({
    ...StagehandConfig,
    // Ensure your OPENAI_API_KEY (or provider API key) is set in env
  });

  await stagehand.init();

  // Create an AISDK-backed agent (omit provider to enable stream())
  const agent = stagehand.agent({
    // Optional: provide custom instructions and execution model for act/observe tools
    instructions:
      "You are a helpful web automation assistant. Keep actions atomic and verify outcomes.",
    // executionModel: "openai/gpt-4o-mini",
  });

  // Start a streaming agent run
  const stream = await agent.stream({
    instruction: "Go to amazon, and order me shoes using random info",
    maxSteps: 20,
    onStepFinish: (event) => {
      const toolNames =
        event.toolCalls?.map((t) => t.toolName).join(", ") || "none";
      console.log(`[step] reason=${event.finishReason} tools=${toolNames}`);
      if (event.text) console.log(`[reasoning] ${event.text}`);
    },
    onFinish: (event) => {
      console.log(`[finish] reason=${event.finishReason}`);
    },
    onError: (event) => {
      console.error(`[error] ${event.error}`);
    },
  });

  // Optionally stop a long-running run
  // setTimeout(() => agent.stop(), 15000);

  await stagehand.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

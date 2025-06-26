import { Stagehand } from "@browserbasehq/stagehand";
import { Tool } from "ai";
import { z } from "zod";

// Example custom tools
const customTools: { [k: string]: Tool } = {
  getWeather: {
    description: "Get the current weather for a location",
    parameters: {
      type: "object",
      properties: {
        location: {
          type: "string",
          description: "The city and state, e.g. San Francisco, CA",
        },
      },
      required: ["location"],
    },
  },
  calculateTip: {
    description: "Calculate the tip amount for a bill",
    parameters: {
      type: "object",
      properties: {
        billAmount: {
          type: "number",
          description: "The total bill amount",
        },
        tipPercentage: {
          type: "number",
          description: "The tip percentage (e.g., 15 for 15%)",
        },
      },
      required: ["billAmount", "tipPercentage"],
    },
  },
};

async function main() {
  // Initialize Stagehand with custom tools
  const stagehand = new Stagehand({
    env: "LOCAL",
    tools: customTools,
    // Enable verbose logging to see tool-related logs
    verbose: 2,
  });

  await stagehand.init();

  // Navigate to a page
  await stagehand.page.goto("https://example.com");

  // Test extract with tools available
  console.log("\n=== Testing extract with tools ===");
  const extractResult = await stagehand.page.extract({
    instruction: "Extract the main heading and any links on the page",
    schema: z.object({
      heading: z.string(),
      links: z.array(z.string().url()),
    }),
  });
  console.log("Extract result:", extractResult);

  // Test observe with tools available
  console.log("\n=== Testing observe with tools ===");
  const observeResult = await stagehand.page.observe(
    "Find all clickable elements",
  );
  console.log("Observe result:", observeResult);

  // Test act with tools available
  console.log("\n=== Testing act with tools ===");
  const actResult = await stagehand.page.act("Click the main heading");
  console.log("Act result:", actResult);

  await stagehand.close();
}

main().catch(console.error);

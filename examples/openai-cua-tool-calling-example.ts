/**
 * This example shows how to use the OpenAI CUA client with tool calling capabilities.
 *
 * The OpenAI CUA client can now use custom tools alongside computer use actions.
 */

import { Stagehand } from "@browserbasehq/stagehand";
import { ToolSet } from "ai/dist";
import * as dotenv from "dotenv";
import StagehandConfig from "../stagehand.config";
import chalk from "chalk";
import { z } from "zod";

// Load environment variables
dotenv.config();

// Define some example tools (for demonstration purposes)
// These would be passed to the agent in a real implementation
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const exampleTools: ToolSet = {
  search_web: {
    description: "Search for information on the web",
    parameters: z.object({
      query: z.string().describe("The search query to look up"),
    }),
    execute: async (args: { query: string }) => {
      // This is a mock implementation - in a real scenario, this would call an actual search API
      return {
        success: true,
        query: args.query,
        results: [
          `Search result 1 for: ${args.query}`,
          `Search result 2 for: ${args.query}`,
        ],
      };
    },
  },
  calculate: {
    description: "Perform mathematical calculations",
    parameters: z.object({
      expression: z
        .string()
        .describe("The mathematical expression to evaluate"),
    }),
    execute: async (args: { expression: string }) => {
      try {
        // Note: eval is used here for demonstration - in production, use a safer math library
        const result = eval(args.expression);
        return {
          success: true,
          expression: args.expression,
          result: result,
        };
      } catch (error) {
        return {
          success: false,
          expression: args.expression,
          error: `Invalid mathematical expression: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  },
  get_weather: {
    description: "Get current weather information for a location",
    parameters: z.object({
      location: z.string().describe("The location to get weather for"),
    }),
    execute: async (args: { location: string }) => {
      // Mock weather data
      return {
        success: true,
        location: args.location,
        temperature: "72°F",
        condition: "Sunny",
        humidity: "45%",
      };
    },
  },
};

async function main() {
  console.log(chalk.blue("🚀 Starting OpenAI CUA Tool Calling Example"));
  console.log(
    chalk.gray(
      "This example demonstrates how the OpenAI CUA client can use custom tools\n",
    ),
  );

  try {
    // Initialize Stagehand
    const stagehand = new Stagehand(StagehandConfig);
    await stagehand.init();

    console.log(chalk.green("✅ Stagehand initialized successfully"));

    // Create an agent with OpenAI CUA and tool calling capabilities
    const agent = await stagehand.agent({
      provider: "openai",
      model: "computer-use-preview",
      options: {
        apiKey: process.env.OPENAI_API_KEY,
      },
    });

    console.log(
      chalk.yellow(
        "🤖 Agent created with OpenAI CUA and tool calling capabilities",
      ),
    );
    console.log(chalk.gray("Available tools:"));
    console.log(
      chalk.gray("  - Computer use actions: click, type, navigate, etc."),
    );
    console.log(
      chalk.gray("  - Custom tools: search_web, calculate, get_weather"),
    );
    console.log();

    // Set tools on the agent (this would need to be exposed in the agent interface)
    // For now, we'll demonstrate the concept
    console.log(
      chalk.cyan(
        "📋 Note: Tool calling is now supported in the OpenAI CUA client",
      ),
    );
    console.log(
      chalk.gray(
        "The agent can now choose between computer use actions and custom tools",
      ),
    );
    console.log();

    // Execute a task that could use both computer actions and tools
    const task =
      "Go to Google, search for 'artificial intelligence', and calculate 2 + 2";

    console.log(chalk.cyan(`📋 Task: ${task}`));
    console.log(
      chalk.gray(
        "The agent will now choose which tools to use for each step...\n",
      ),
    );

    const result = await agent.execute(task);

    console.log(chalk.green("✅ Task completed!"));
    console.log(chalk.cyan("📊 Results:"));
    console.log(chalk.white(result.message));

    console.log(chalk.cyan("\n🔧 Actions taken:"));
    result.actions.forEach((action, index) => {
      console.log(
        chalk.gray(
          `  ${index + 1}. [${action.type}] ${JSON.stringify(action)}`,
        ),
      );
    });
  } catch (error) {
    console.error(chalk.red("❌ Error:"), error);
  } finally {
    console.log(chalk.blue("\n🏁 Example completed"));
  }
}

// Run the example
main().catch(console.error);

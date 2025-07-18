/**
 * This example shows how to use the Stagehand operator with tool calling capabilities.
 *
 * The operator can now choose to call tools instead of performing page actions at each step.
 * Each Stagehand method (act, extract, goto, wait, navback, refresh, close) is now a tool
 * that the LLM can choose to call, along with any MCP tools that are provided.
 */

import { Stagehand } from "@browserbasehq/stagehand";
import { ToolSet } from "ai/dist";
import * as dotenv from "dotenv";
import StagehandConfig from "../stagehand.config";
import chalk from "chalk";
import { z } from "zod";

// Load environment variables
dotenv.config();

// Define some example MCP tools with proper Zod schemas
const exampleMCPTools: ToolSet = {
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
};

async function main() {
  console.log(
    chalk.blue("🚀 Starting Stagehand Operator Tool Calling Example"),
  );
  console.log(
    chalk.gray(
      "This example demonstrates how the operator can choose between Stagehand methods and MCP tools\n",
    ),
  );

  try {
    // Initialize Stagehand
    const stagehand = new Stagehand(StagehandConfig);
    await stagehand.init();

    console.log(chalk.green("✅ Stagehand initialized successfully"));

    // Convert ToolSet to Tool[] for the agent
    const toolsArray = Object.entries(exampleMCPTools).map(([name, tool]) => ({
      ...tool,
      name,
    }));

    // Create an agent with tool calling capabilities
    const agent = stagehand.agent({
      integrations: [], // No MCP integrations for this example
      tools: toolsArray, // Pass our example tools
    });

    console.log(
      chalk.yellow("🤖 Agent created with tool calling capabilities"),
    );
    console.log(chalk.gray("Available tools:"));
    console.log(
      chalk.gray(
        "  - Stagehand methods: act, extract, goto, wait, navback, refresh, close",
      ),
    );
    console.log(chalk.gray("  - MCP tools: search_web, calculate"));
    console.log();

    // Execute a task that will use both Stagehand methods and MCP tools
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
        chalk.gray(`  ${index + 1}. [${action.type}] ${action.reasoning}`),
      );
      if (action.extractionResult) {
        console.log(
          chalk.gray(
            `     Extracted: ${JSON.stringify(action.extractionResult)}`,
          ),
        );
      }
    });
  } catch (error) {
    console.error(chalk.red("❌ Error:"), error);
  } finally {
    console.log(chalk.blue("\n🏁 Example completed"));
  }
}

// Run the example
main().catch(console.error);

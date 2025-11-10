/**
 * This example demonstrates how to use the streaming API for Stagehand agents.
 *
 * Streaming allows you to:
 * - Get real-time updates as the agent executes
 * - Monitor token usage per step
 * - Cancel long-running operations
 * - Process agent output as it's generated
 */

import { Stagehand } from "../lib/v3";
import dotenv from "dotenv";
import chalk from "chalk";

dotenv.config();

async function main() {
  console.log(`\n${chalk.bold("Stagehand 🤘 Agent Streaming Example")}\n`);

  const stagehand = new Stagehand({
    env: "LOCAL",
    verbose: 0,
  });

  await stagehand.init();

  try {
    const page = stagehand.context.pages()[0];
    await page.goto("https://www.google.com");

    const agent = stagehand.agent({
      model: "anthropic/claude-haiku-4-5",
    });

    console.log(chalk.cyan("Starting agent with streaming...\n"));

    const stream = await agent.stream({
      instruction: "Search for 'Stagehand browser automation' and click the first result",
      maxSteps: 10,

    });
    for await (const chunk of stream.textStream) {
      console.log(chalk.gray(JSON.stringify(chunk, null, 2)));
    }

  } catch (error) {
    console.error(chalk.red(`\n✗ Error: ${error}`));
  } finally {
    await stagehand.close();
  }
}

// Example with abort/stop functionality
async function exampleWithAbort() {
  console.log(`\n${chalk.bold("Stagehand 🤘 Agent Streaming with Abort Example")}\n`);

  const stagehand = new Stagehand({
    env: "LOCAL",
    verbose: 1,
  });

  await stagehand.init();

  try {
    const page = stagehand.context.pages()[0];
    await page.goto("https://www.google.com");

    const agent = stagehand.agent({
      model: "openai/gpt-4o-mini",
    });

    console.log(chalk.cyan("Starting agent (will abort after 5 seconds)...\n"));

    // Set up auto-abort after 5 seconds
    setTimeout(() => {
      console.log(chalk.yellow("\n⚠️  Aborting agent execution..."));
      agent.stop();
    }, 5000);

    const stream = await agent.stream({
      instruction: "Search for information about AI and browser automation, then visit multiple sites and summarize them",
      maxSteps: 20,
      onStepFinish: async (event) => {
        console.log(chalk.blue(`Step completed: ${event.finishReason}`));
      },
    });

    try {
      await stream.text;
    } catch (error) {
      if (error.name === "AbortError") {
        console.log(chalk.yellow("✓ Agent execution was successfully aborted"));
      } else {
        throw error;
      }
    }

  } catch (error) {
    console.error(chalk.red(`✗ Error: ${error}`));
  } finally {
    await stagehand.close();
  }
}

// Run the main example
// Uncomment below to run the abort example instead
main();
// exampleWithAbort();

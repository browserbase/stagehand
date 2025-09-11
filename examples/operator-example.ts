/**
 * This example shows how to use the Stagehand operator to do simple autonomous tasks.
 *
 * This is built off of our open source project, Open Operator: https://operator.browserbase.com
 *
 * To learn more about Stagehand Agents, see: https://docs.stagehand.dev/concepts/agent
 */

import { Stagehand } from "@browserbasehq/stagehand";
import dotenv from "dotenv";
import StagehandConfig from "@/stagehand.config";
import chalk from "chalk";

// Load environment variables
dotenv.config();

const INSTRUCTION = "buy me stuff on gamestop";

async function main() {
  console.log(`\n${chalk.bold("Stagehand 🤘 Operator Example")}\n`);

  // Initialize Stagehand
  const stagehand = new Stagehand({
    ...StagehandConfig,
  });

  await stagehand.init();

  try {
    // Execute the agent
    const agent = stagehand.agent({
      executionModel: "google/gemini-2.5-flash",
    });
    console.log(`${chalk.cyan("↳")} Instruction: ${INSTRUCTION}`);
    await stagehand.page.goto("https://gamestop.com");
    await agent.execute({
      instruction: INSTRUCTION,
      maxSteps: 100,
    });
  } catch (error) {
    console.log(`${chalk.red("✗")} Error: ${error}`);
  } finally {
    await stagehand.close();
  }
}

main();

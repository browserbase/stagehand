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

const INSTRUCTION =
  "buy me a pair of the kith birkenstocks, you are currently on the product page, fill checkout with random info, and do not submit it i am just testing";

async function main() {
  console.log(`\n${chalk.bold("Stagehand 🤘 Operator Example")}\n`);

  // Initialize Stagehand
  const stagehand = new Stagehand({
    ...StagehandConfig,
  });

  await stagehand.init();

  try {
    const agent = stagehand.agent({
      executionModel: "google/gemini-2.5-flash",
    });

    // Execute the agent
    console.log(`${chalk.cyan("↳")} Instruction: ${INSTRUCTION}`);
    await stagehand.page.goto(
      "https://kith.com/collections/kith-footwear/products/br1030958",
    );
    const result = await agent.execute({
      instruction: INSTRUCTION,
      maxSteps: 100,
    });

    console.log(`${chalk.green("✓")} Execution complete`);
    console.log(`${chalk.yellow("⤷")} Result:`);
    console.log(JSON.stringify(result, null, 2));
    console.log(chalk.white(result.message));
  } catch (error) {
    console.log(`${chalk.red("✗")} Error: ${error}`);
  } finally {
    await stagehand.close();
  }
}

main();

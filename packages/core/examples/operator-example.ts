/**
 * This example shows how to use the Stagehand operator to do simple autonomous tasks.
 *
 * This is built off of our open source project, Open Operator: https://operator.browserbase.com
 *
 * To learn more about Stagehand Agents, see: https://docs.stagehand.dev/concepts/agent
 */

import { Stagehand } from "../lib/v3";
import dotenv from "dotenv";
import chalk from "chalk";

// Load environment variables
dotenv.config();

async function main() {
  console.log(`\n${chalk.bold("Stagehand 🤘 Operator Example")}\n`);

  // Initialize Stagehand
  const stagehand = new Stagehand({
    env: "BROWSERBASE",
    verbose: 2,
    logInferenceToFile: false,
    model: {
      modelName: "anthropic/claude-haiku-4-5",
      apiKey: process.env.ANTHROPIC_API_KEY,
    },
  });

  await stagehand.init();

  try {
    const page = stagehand.context.pages()[0];
    await page.goto(
      "https://v0-modern-login-flow.vercel.app/",
    );
   
    await stagehand.act("type  into the email field");
    await stagehand.act("type Into the password field");

    await stagehand.close();

  } catch (error) {
    console.log(`${chalk.red("✗")} Error: ${error}`);
  } finally {
    // await stagehand.close();
  }
}

main();

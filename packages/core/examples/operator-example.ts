/**
 * This example shows how to use the Stagehand operator to do simple autonomous tasks.
 *
 * This is built off of our open source project, Open Operator: https://operator.browserbase.com
 *
 * To learn more about Stagehand Agents, see: https://docs.stagehand.dev/concepts/agent
 */
import { Stagehand } from "../lib/v3/index.js";
import chalk from "chalk";
import dotenv from "dotenv";
dotenv.config();
// Load environment variables

async function main() {
  console.log(`\n${chalk.bold("Stagehand 🤘 Operator Example")}\n`);
  // Initialize Stagehand
  const stagehand = new Stagehand({
    env: "LOCAL",
    verbose: 2,
    //cacheDir: "stagehand-agent-cache",
    logInferenceToFile: false,
    experimental: true,
    model: "google/gemini-3-flash-preview",
  });

  await stagehand.init();

  try {
    const page = stagehand.context.pages()[0];
    await page.goto(
      "https://browserbase.github.io/stagehand-eval-sites/sites/shadow-dom/",
    );
    const agent = stagehand.agent();
    const result = await agent.execute({
      instruction: "go to amazon, and cart me a random shampoo",
      maxSteps: 20,

    });

    console.log(`${chalk.green("✓")} Execution complete`);
    console.log(`${chalk.yellow("⤷")} Result:`);
    console.log(JSON.stringify(result, null, 2));
    console.log(chalk.white(result.message));
  } catch (error) {
    console.log(`${chalk.red("✗")} Error: ${error}`);
  } finally {
    // await stagehand.close();
  }
}
main();

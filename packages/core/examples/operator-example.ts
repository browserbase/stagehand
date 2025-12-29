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
import { writeFileSync } from "fs";

// Load environment variables
dotenv.config();
async function main() {
  console.log(`\n${chalk.bold("Stagehand 🤘 Operator Example")}\n`);
  // Initialize Stagehand
  const stagehand = new Stagehand({
    env: "LOCAL",
    verbose: 2,
    //cacheDir: "stagehand-agent-cache",
    logInferenceToFile: false,
  });

  await stagehand.init();

  try {
    const page = stagehand.context.pages()[0];
    await page.goto("https://www.amazon.com/");
    const agent = stagehand.agent({
      mode: "hybrid",
      model: "google/gemini-3-flash-preview",
    });

    const result = await agent.execute({
      instruction:
        "search for shampoo on amazon, add a random one to cart, and go to checkout",
      maxSteps: 20,
    });

    console.log(`${chalk.green("✓")} Execution complete`);
    console.log(`${chalk.yellow("⤷")} Result:`);
    console.log(JSON.stringify(result, null, 2));
    console.log(chalk.white(result.message));

    // Write messages to file for inspection
    if (result.messages) {
      const messagesPath = "agent-messages.json";
      writeFileSync(messagesPath, JSON.stringify(result.messages, null, 2));
      console.log(
        `${chalk.cyan("📝")} Messages written to ${chalk.underline(messagesPath)}`,
      );
    }
  } catch (error) {
    console.log(`${chalk.red("✗")} Error: ${error}`);
  } finally {
    // await stagehand.close();
  }
}
main();

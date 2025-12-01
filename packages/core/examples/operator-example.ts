/**
 * This example shows how to use the Stagehand operator to do simple autonomous tasks
 * with conversation continuation using the messages parameter.
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
    cacheDir: "stagehand-agent-cache",
    logInferenceToFile: false,
    model: {
      modelName: "google/gemini-2.0-flash",
      apiKey: process.env.GOOGLE_API_KEY,
    },
  });

  await stagehand.init();

  try {
    const page = stagehand.context.pages()[0];
    await page.goto(
      "https://browserbase.github.io/stagehand-eval-sites/sites/shadow-dom/",
    );
    const agent = stagehand.agent({
      model: {
        modelName: "google/gemini-2.0-flash",
        apiKey: process.env.GOOGLE_API_KEY,
      },
    });

    // First execution - click the button
    console.log(`${chalk.blue("→")} Step 1: Click the button`);
    const handle1 = agent.execute({
      instruction: " step 1: click the button",
      maxSteps: 20,
    });

    // Wait for the first result
    const result1 = await handle1.result;

    console.log(`${chalk.green("✓")} Step 1 complete`);
    console.log(chalk.white(result1.message));

    // Continue the conversation - pass messages from previous run
    console.log(`\n${chalk.blue("→")} Step 2: Ask about the page state`);
    const handle2 = agent.execute({
      instruction: "what did i originally ask for in step 1?",
      maxSteps: 10,
      messages: result1.messages, // Continue from where we left off
    });

    const result2 = await handle2.result;

    console.log(`${chalk.green("✓")} Step 2 complete`);
    console.log(`${chalk.yellow("⤷")} Final Result:`);
    console.log(chalk.white(result2.message));
  } catch (error) {
    console.log(`${chalk.red("✗")} Error: ${error}`);
  } finally {
    await stagehand.close();
  }
}
main();

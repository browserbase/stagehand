import chalk from "chalk";
import { Stagehand } from "../lib/v3/index.js";

const INSTRUCTION = "scroll down and click on the last hn story";

async function main() {
  console.log(`\n${chalk.bold("Stagehand V3 🤘 Operator Example")}\n`);

  // Initialize Stagehand
  const stagehand = new Stagehand({
    env: "LOCAL",
    verbose: 2,
  });

  await stagehand.init();

  try {
    const startPage = stagehand.context.pages()[0];
    await startPage.goto(
      "https://browserbase.github.io/stagehand-eval-sites/sites/iframe-hn/",
    );
    const agent = stagehand.agent({
      cua: false,
      model: "google/gemini-2.0-flash",
      executionModel: "google/gemini-2.0-flash",
    });
    // {
    //   model: "computer-use-preview-2025-03-11",
    //   provider: "openai",
    // }

    // Execute the agent
    console.log(`${chalk.cyan("↳")} Instruction: ${INSTRUCTION}`);
    const result = await agent.execute({
      instruction: INSTRUCTION,
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

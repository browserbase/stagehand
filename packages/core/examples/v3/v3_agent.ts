import chalk from "chalk";
import { V3 } from "../../lib/v3";

const INSTRUCTION = "click the button";

async function main() {
  console.log(`\n${chalk.bold("Stagehand V3 🤘 Operator Example")}\n`);

  // Initialize Stagehand
  const v3 = new V3({
    env: "LOCAL",
    verbose: 2,
    cacheDir: "agent-cache",
  });

  await v3.init();

  try {
    const startPage = v3.context.pages()[0];
    await startPage.goto(
      "https://browserbase.github.io/stagehand-eval-sites/sites/shadow-dom/",
    );
    const agent = v3.agent({
      cua: false,
      model: "google/gemini-2.0-flash",
      executionModel: "google/gemini-2.0-flash",
    });

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
    // await v3.close();
  }
}

main();

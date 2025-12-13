/**
 * This example shows how to use a computer use agent (CUA) to navigate a web page and extract data.
 *
 * To learn more about the CUA, see: https://docs.stagehand.dev/examples/computer_use
 *
 * NOTE: YOU MUST CONFIGURE BROWSER DIMENSIONS TO USE COMPUTER USE!
 * Check out stagehand.config.ts for more information.
 */
import { Stagehand } from "../lib/v3";
import chalk from "chalk";

async function main() {
  console.log(
    `\n${chalk.bold("Stagehand 🤘 Computer Use Agent (CUA) Demo")}\n`,
  );

  // Initialize Stagehand
  const stagehand = new Stagehand({
    env: "LOCAL",
    verbose: 2,
  });
  await stagehand.init();

  try {
    const page = stagehand.context.pages()[0];

    // Create a computer use agent
    const agent = stagehand.agent({
      cua: true,
      model: {
        modelName: "google/gemini-2.5-computer-use-preview-10-2025",
        apiKey: process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY,
      },
      systemPrompt: `You are a helpful assistant that can use a web browser.
      You are currently on the following page: ${page.url()}.
      Do not ask follow up questions, the user will trust your judgement. Today's date is ${new Date().toLocaleDateString()}.`,
    });

    // Navigate to the Browserbase careers page
    await page.goto("https://www.browserbase.com/careers");

    // Define the instruction for the CUA
    const instruction =
      "Apply for the first engineer position with mock data. Don't submit the form. You're on the right page";
    console.log(`Instruction: ${chalk.white(instruction)}`);

    // Execute the instruction
    const result = await agent.execute({
      instruction,
      maxSteps: 20,
    });
    await new Promise((resolve) => setTimeout(resolve, 30000));

    console.log(`${chalk.green("✓")} Execution complete`);
    console.log(`${chalk.yellow("⤷")} Result:`);
    console.log(chalk.white(JSON.stringify(result, null, 2)));
  } catch (error) {
    console.log(`${chalk.red("✗")} Error: ${error}`);
    if (error instanceof Error && error.stack) {
      console.log(chalk.dim(error.stack.split("\n").slice(1).join("\n")));
    }
  } finally {
    // Close the browser
    await stagehand.close();
  }
}

main().catch((error) => {
  console.log(`${chalk.red("✗")} Unhandled error in main function`);
  console.log(chalk.red(error));
});

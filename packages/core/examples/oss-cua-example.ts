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
    localBrowserLaunchOptions: {
      viewport: {
        width: 1288,
        height: 711,
      },
      deviceScaleFactor: 1,
    },
  });
  await stagehand.init();

  try {
    const page = stagehand.context.pages()[0];

    // Create a computer use agent
    const agent = stagehand.agent({
      cua: true,
      model: {
        modelName: "microsoft/fara-7b",
        apiKey: process.env.AZURE_API_KEY,
        baseURL: process.env.AZURE_ENDPOINT,
        /** Alternative model configuration for Fireworks Deployments */
        // modelName: "accounts/...",
        // apiKey: process.env.FIREWORKS_API_KEY,
        // baseURL: "https://api.fireworks.ai/inference/v1",
        // provider: "microsoft", // Important: this routes to the MicrosoftCUAClient
      },
      systemPrompt: `You are a helpful assistant that can use a web browser.
      You are currently on the following page: ${page.url()}.
      Do not ask follow up questions, the user will trust your judgement. Today's date is ${new Date().toLocaleDateString()}. Remember apply buttons are there for a reason.`,
    });

    // Navigate to the Browserbase careers page
    await page.goto("https://www.browserbase.com/careers");

    // Define the instruction for the CUA
    const instruction = `Apply for the first engineer position with mock data on the ${page.url()} page. Don't submit the form.`;
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

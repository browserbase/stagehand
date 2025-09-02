import { Stagehand } from "@browserbasehq/stagehand";
import StagehandConfig from "@/stagehand.config";
import chalk from "chalk";

async function main() {
  console.log(
    `\n${chalk.bold("Stagehand 🤘 Computer Use Agent (CUA) Demo")}\n`,
  );

  // Initialize Stagehand
  const stagehand = new Stagehand({
    ...StagehandConfig,
    env: "LOCAL",
    experimental: true,
  });
  await stagehand.init();

  try {
    const page = stagehand.page;

    // Create a computer use agent
    const agent = stagehand.agent({
      provider: "anthropic",
      // For Anthropic, use claude-sonnet-4-20250514 or claude-3-7-sonnet-latest
      model: "claude-sonnet-4-20250514",
      instructions: `You are a helpful assistant that can use a web browser.
      You are currently on the following page: ${page.url()}.
      Do not ask follow up questions, the user will trust your judgement.
      You have access to the Exa MCP.`,
      options: {
        apiKey: process.env.ANTHROPIC_API_KEY,
      },
      integrations: [
        `https://mcp.exa.ai/mcp?exaApiKey=${process.env.EXA_API_KEY}`,
      ],
    });

    // Navigate to the Browserbase careers page
    await page.goto("https://www.google.com");
    // Define the instruction for the CUA
    const instruction = `Do a simple research query using Exa for the latest trades in LaLiga and confirm the results by visiting marca.com. Today's date is ${new Date().toLocaleDateString()}.`;
    console.log(`Instruction: ${chalk.white(instruction)}`);

    // Execute the instruction
    const result = await agent.execute({
      instruction,
      maxSteps: 50,
    });

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

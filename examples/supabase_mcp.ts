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
    // browserbaseSessionCreateParams: {
    //   projectId: process.env.BROWSERBASE_PROJECT_ID,
    //   browserSettings: {
    //     context: {
    //     id: "917989d3-248b-4eab-be03-9b36a8da4328",
    //     persist: true,
    //   },
    // },
    // }
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
      You have access to the Supabase MCP.`,
      options: {
        apiKey: process.env.ANTHROPIC_API_KEY,
      },
      integrations: [`https://mcp.supabase.com/mcp`],
    });

    // Navigate to the Browserbase careers page
    await page.goto("https://www.google.com");
    // Define the instruction for the CUA
    const instruction =
      "Go find the cheapest tapping screws across home depot and Ace Hardware. Store the results in the Supabase tapping_screws table. Create the table if it doesn't exist.";
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

import { connectToMCPServer, Stagehand } from "../lib/v3/index.js";
import chalk from "chalk";

async function main() {
  console.log(`\n${chalk.bold("Stagehand 🤘 MCP Demo")}\n`);
  console.log(process.env.NOTION_TOKEN);

  // Initialize Stagehand
  const stagehand = new Stagehand({
    env: "LOCAL",
    model: "anthropic/claude-sonnet-4-6",
    experimental: true,
  });
  await stagehand.init();

  const notionClient = await connectToMCPServer({
    command: "npx",
    args: ["-y", "@notionhq/notion-mcp-server"],
    env: {
      NOTION_TOKEN: process.env.NOTION_TOKEN,
    },
  });

  try {
    const page = stagehand.context.pages()[0];

    // Create a computer use agent
    const agent = stagehand.agent({
      mode: "hybrid",
      // For Anthropic, use claude-sonnet-4-6 or claude-sonnet-4-5-20250929
      model: "anthropic/claude-sonnet-4-6",
      systemPrompt: `You are a helpful assistant that can use a web browser.
      You are currently on the following page: ${page.url()}.
      Do not ask follow up questions, the user will trust your judgement.
      You have access to the Notion MCP.`,
      integrations: [notionClient],
    });

    // Navigate to the Browserbase careers page
    await page.goto("https://www.google.com");

    // Define the instruction for the CUA
    const instruction =
      "Check the Agent Tasks page in notion, read your tasks, perform them and update the notion page with the results.";
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

// import { Stagehand } from "../lib/v3";
// import StagehandConfig from "@/stagehand.config";
// import chalk from "chalk";
// import { connectToMCPServer } from "../lib/mcp/connection";

// async function main() {
//   console.log(`\n${chalk.bold("Stagehand 🤘 MCP Demo")}\n`);
//   console.log(process.env.NOTION_TOKEN);

//   // Initialize Stagehand
//   const stagehand = new Stagehand({
//     ...StagehandConfig,
//     env: "LOCAL",
//     experimental: true,
//   });
//   await stagehand.init();

//   const notionClient = await connectToMCPServer({
//     command: "npx",
//     args: ["-y", "@notionhq/notion-mcp-server"],
//     env: {
//       NOTION_TOKEN: process.env.NOTION_TOKEN,
//     },
//   });

//   try {
//     const page = stagehand.page;

//     // Create a computer use agent
//     const agent = stagehand.agent({
//       provider: "anthropic",
//       // For Anthropic, use claude-sonnet-4-6 or claude-sonnet-4-5-20250929
//       model: "claude-sonnet-4-6",
//       instructions: `You are a helpful assistant that can use a web browser.
//       You are currently on the following page: ${page.url()}.
//       Do not ask follow up questions, the user will trust your judgement.
//       You have access to the Notion MCP.`,
//       options: {
//         apiKey: process.env.ANTHROPIC_API_KEY,
//       },
//       integrations: [notionClient],
//     });

//     // Navigate to the Browserbase careers page
//     await page.goto("https://www.google.com");

//     // Define the instruction for the CUA
//     const instruction =
//       "Check the Agent Tasks page in notion, read your tasks, perform them and update the notion page with the results.";
//     console.log(`Instruction: ${chalk.white(instruction)}`);

//     // Execute the instruction
//     const result = await agent.execute({
//       instruction,
//       maxSteps: 50,
//     });

//     console.log(`${chalk.green("✓")} Execution complete`);
//     console.log(`${chalk.yellow("⤷")} Result:`);
//     console.log(chalk.white(JSON.stringify(result, null, 2)));
//   } catch (error) {
//     console.log(`${chalk.red("✗")} Error: ${error}`);
//     if (error instanceof Error && error.stack) {
//       console.log(chalk.dim(error.stack.split("\n").slice(1).join("\n")));
//     }
//   } finally {
//     // Close the browser
//     await stagehand.close();
//   }
// }

// main().catch((error) => {
//   console.log(`${chalk.red("✗")} Unhandled error in main function`);
//   console.log(chalk.red(error));
// });

import { Stagehand } from "../lib/v3";
import dotenv from "dotenv";
import chalk from "chalk";

// Load environment variables
dotenv.config();
async function main() {
  console.log(`\n${chalk.bold("Stagehand 🤘 Agent Streaming Example")}\n`);
  // Initialize Stagehand
  const stagehand = new Stagehand({
    env: "LOCAL",
    verbose: 0,
    cacheDir: "stagehand-agent-cache",
    logInferenceToFile: false,
    experimental: true,
  });

  await stagehand.init();

  try {
    const page = stagehand.context.pages()[0];
    await page.goto("https://amazon.com");

    // Create a streaming agent with stream: true in the config
    const agent = stagehand.agent({
      model: "anthropic/claude-sonnet-4-5-20250929",
      stream: true, // This makes execute() return AgentStreamResult
    });

    const agentRun = await agent.execute({
      instruction: "go to amazon, and search for shampoo, stop after searching",
      maxSteps: 20,
    });
    // stream the text
    for await (const delta of agentRun.textStream) {
      process.stdout.write(delta);
    }
    // stream everything ( toolcalls, messages, etc.)
    // for await (const delta of result.fullStream) {
    //   console.log(delta);
    // }

    const finalResult = await agentRun.result;
    console.log("Final Result:", finalResult);
  } catch (error) {
    console.log(`${chalk.red("✗")} Error: ${error}`);
  }
}
main();

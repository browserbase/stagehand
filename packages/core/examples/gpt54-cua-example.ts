import { Stagehand } from "../lib/v3/index.js";
import chalk from "chalk";

async function main() {
  console.log(`\n${chalk.bold("Stagehand 🤘 GPT-5.4 CUA Demo")}\n`);

  const stagehand = new Stagehand({
    env: "LOCAL",
    verbose: 2,
  });
  await stagehand.init();

  try {
    const page = stagehand.context.pages()[0];

    const agent = stagehand.agent({
      mode: "cua",
      model: {
        modelName: "openai/gpt-5.4",
        apiKey: process.env.OPENAI_API_KEY,
      },
      systemPrompt: `You are a helpful assistant that can use a web browser.
      Do not ask follow up questions, the user will trust your judgement.
      Today's date is ${new Date().toLocaleDateString()}.`,
    });

    await page.goto("https://news.ycombinator.com");

    const instruction =
      "Find the top story on Hacker News and tell me its title, link, and point count and then click on it and extract a summary for me";
    console.log(`Instruction: ${chalk.white(instruction)}`);

    const result = await agent.execute({
      instruction,
      maxSteps: 10,
    });

    console.log(`\n${chalk.green("✓")} Done`);
    console.log(`${chalk.yellow("⤷")} ${result.message}`);
  } catch (error) {
    console.error(`${chalk.red("✗")} Error:`, error);
  } finally {
    await stagehand.close();
  }
}

main();

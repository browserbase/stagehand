/**
 * This example shows how to use the Yutori Navigator n1.5 computer-use model
 * as a Stagehand CUA agent to navigate a web page and complete a task.
 *
 * Navigator n1.5 is served via an OpenAI-compatible Chat Completions API at
 * https://api.yutori.com/v1 and reasons over screenshots with coordinate-based
 * actions in a normalized 1000x1000 space.
 *
 * Setup:
 *   export YUTORI_API_KEY=yt-...
 *
 * @see https://docs.yutori.com/reference/n1-5.md
 *
 * NOTE: Configure browser dimensions when using a computer use agent.
 */
import { Stagehand } from "../lib/v3/index.js";
import chalk from "chalk";

async function main() {
  console.log(`\n${chalk.bold("Stagehand 🤘 Yutori Navigator n1.5 Demo")}\n`);

  const stagehand = new Stagehand({
    env: "LOCAL",
    verbose: 2,
    localBrowserLaunchOptions: {
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 1,
    },
  });
  await stagehand.init();

  try {
    const page = stagehand.context.pages()[0];

    const agent = stagehand.agent({
      mode: "cua",
      model: {
        modelName: "yutori/n1.5-latest",
        // Defaults to process.env.YUTORI_API_KEY and https://api.yutori.com/v1.
        apiKey: process.env.YUTORI_API_KEY,
        // baseURL: "https://api.yutori.com/v1",
        // Optional Navigator tuning:
        // Defaults to the expanded tool set (adds extract_elements/find/
        // set_element_value/execute_js). Pass core for coordinate-only:
        // toolSet: "browser_tools_core-20260403",
        // disableTools: ["mouse_down", "mouse_up"],
        // User context defaults to San Francisco / America/Los_Angeles —
        // override for location- or time-sensitive tasks:
        // userTimezone: "America/New_York",
        // userLocation: "New York, NY, US",
      },
    });

    await page.goto("https://www.yutori.com");

    const instruction = "List the names of the team members on this site.";
    console.log(`Instruction: ${chalk.white(instruction)}`);

    const result = await agent.execute({
      instruction,
      maxSteps: 30,
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
    await stagehand.close();
  }
}

main().catch((error) => {
  console.log(`${chalk.red("✗")} Unhandled error in main function`);
  console.log(chalk.red(error));
});

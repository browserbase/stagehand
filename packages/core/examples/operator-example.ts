/**
 * This example shows how to use the Stagehand operator to do simple autonomous tasks.
 *
 * This is built off of our open source project, Open Operator: https://operator.browserbase.com
 *
 * To learn more about Stagehand Agents, see: https://docs.stagehand.dev/concepts/agent
 */

import { Stagehand } from "../lib/v3";
import dotenv from "dotenv";
import chalk from "chalk";
import z from "zod";

// Load environment variables
dotenv.config();

async function main() {
  console.log(`\n${chalk.bold("Stagehand 🤘 Operator Example")}\n`);

  // Initialize Stagehand
  const stagehand = new Stagehand({
    env: "LOCAL",
    verbose: 2,
    cacheDir: "stagehand-agent-cache",
    logInferenceToFile: false,
    model: "google/gemini-2.5-flash",
  });

  await stagehand.init();

  try {
    const page = stagehand.context.pages()[0];
    await page.goto(
      "https://browserbase.github.io/stagehand-eval-sites/sites/jfk/",
    );

    const extraction = await stagehand.extract(
      "extract all the record file name and their corresponding links",
      z.object({
        records: z.array(
          z.object({
            file_name: z.string().describe("the file name of the record"),
            link: z.string().url(),
          }),
        ),
      }),
    );

    console.log(extraction);

    console.log(`${chalk.green("✓")} Execution complete`);
    console.log(`${chalk.yellow("⤷")} Result:`);
  } catch (error) {
    console.log(`${chalk.red("✗")} Error: ${error}`);
  } finally {
    // await stagehand.close();
  }
}

main();

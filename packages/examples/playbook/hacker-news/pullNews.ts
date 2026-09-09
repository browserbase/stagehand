import { Stagehand } from "@browserbasehq/stagehand";
import { z } from "zod";
import chalk from "chalk";
import boxen from "boxen";
import dotenv from "dotenv";

dotenv.config();

async function main() {
  const stagehand = new Stagehand({
    env: "BROWSERBASE",
  });

  await stagehand.init();
  const page = stagehand.page;

  if (stagehand.env === "BROWSERBASE" && stagehand.browserbaseSessionID) {
    console.log("Session completed. Waiting for 10 seconds to see the logs and recording...");

    // Log your session recording in the terminal so you can see it
    console.log(
      boxen(
        `View this session recording in your browser: \n${chalk.blue(
          `https://browserbase.com/sessions/${stagehand.browserbaseSessionID}`,
        )}`,
        {
          title: "Browserbase",
          padding: 1,
          margin: 3,
        },
      ),
    );
  }

  // Navigate to Hacker News
  await page.goto("https://news.ycombinator.com");

  console.log("Pulling news from Hacker News...");

  // Extract the top 3 stories from the Hacker News homepage
  const headlines = await page.extract({
    instruction: "Extract the top 3 stories from the Hacker News homepage.",
    schema: z.object({
      stories: z.array(
        z.object({
          title: z.string(),
          url: z.string(),
        }),
      ),
    }),
  });

  console.log(headlines);

  //   Close the browser
  await stagehand.close();
}

main();

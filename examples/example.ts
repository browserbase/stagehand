/**
 * 🤘 Welcome to Stagehand!
 *
 * TO RUN THIS PROJECT:
 * ```
 * npm install
 * npm run start
 * ```
 *
 * In this quickstart, we'll be automating a browser session to show you the power of Playwright and Stagehand's AI features.
 *
 * 1. Go to https://docs.browserbase.com/
 * 2. Use `extract` to find information about the quickstart
 * 3. Use `observe` to find the links under the 'Guides' section
 * 4. Use Playwright to click the first link. If it fails, use `act` to gracefully fallback to Stagehand AI.
 */

import StagehandConfig from "./stagehand.config";
import { Stagehand } from "../lib";
import { z } from "zod";
import chalk from "chalk";
import boxen from "boxen";
import dotenv from "dotenv";

dotenv.config();

function announce(message: string, title?: string) {
  console.log(
    boxen(message, {
      padding: 1,
      margin: 3,
      title: title || "Stagehand",
    }),
  );
}

async function main() {
  console.log(
    [
      `🤘 ${chalk.yellow("Welcome to Stagehand!")}`,
      "",
      "Stagehand is a tool that allows you to automate browser interactions.",
      "In this quickstart, we'll be automating a browser session to show you the power of Playwright and Stagehand's AI features.",
      "",
      `1. Go to ${chalk.blue("https://docs.browserbase.com/")}`,
      `2. Use ${chalk.green("extract")} to find information about the quickstart`,
      `3. Use ${chalk.green("observe")} to find the links under the 'Guides' section`,
      `4. Use Playwright to click the first link. If it fails, use ${chalk.green("act")} to gracefully fallback to Stagehand AI.`,
      "",
      `${chalk.bold(chalk.green("PRESS ENTER TO CONTINUE..."))}`,
    ].join("\n"),
  );

  await new Promise((resolve) => {
    process.stdin.once("data", () => {
      resolve(undefined);
    });
  });
  const stagehand = new Stagehand({
    ...StagehandConfig,
  });
  await stagehand.init();
  const page = stagehand.page;

  if (StagehandConfig.env === "BROWSERBASE") {
    console.log(
      boxen(
        `View this session live in your browser: \n${chalk.blue(
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

  //   You can use the `page` instance to write any Playwright code
  //   For more info: https://playwright.dev/docs/pom
  await page.goto("https://docs.browserbase.com/");

  const description = await stagehand.extract({
    instruction: "extract the title, description, and link of the quickstart",
    // Zod is a schema validation library similar to Pydantic in Python
    // For more information on Zod, visit: https://zod.dev/
    schema: z.object({
      title: z.string(),
      link: z.string(),
      description: z.string(),
    }),
  });
  announce(
    `The ${chalk.bgYellow(description.title)} is at: ${chalk.bgYellow(
      chalk.blue(description.link),
    )}` +
      `\n\n${chalk.bgYellow(description.description)}` +
      `\n\n${chalk.gray(JSON.stringify(description, null, 2))}`,
    "Extract",
  );

  const observeResult = await stagehand.observe({
    instruction: "Find the links under the 'Guides' section",
  });
  announce(
    `${chalk.green("Observe:")} We can click:\n${observeResult
      .map(
        (r) => `"${chalk.yellow(r.description)}" -> ${chalk.gray(r.selector)}`,
      )
      .join("\n")}`,
    "Observe",
  );

  //   In the event that your Playwright code fails, you can use the `act` method to
  //   let Stagehand AI take over and complete the action.
  try {
    throw new Error(
      "Comment out line 115 in index.ts to run the base Playwright code!",
    );

    // Wait for search button and click it
    const quickStartSelector = `#content-area > div.relative.mt-8.prose.prose-gray.dark\:prose-invert > div > a:nth-child(1)`; // eslint-disable-line
    await page.waitForSelector(quickStartSelector);
    await page.locator(quickStartSelector).click();
    await page.waitForLoadState("networkidle");
    announce(
      `Clicked the quickstart link using base Playwright code. ${chalk.yellow(
        "Uncomment line 82 in index.ts to have Stagehand take over!",
      )}`,
    );
  } catch (e: unknown) {
    if (e instanceof Error) {
      announce(
        `${chalk.red("Looks like an error occurred running Playwright. Let's have Stagehand take over!")} \n${chalk.gray(
          e.message,
        )}`,
        "Playwright",
      );

      const actResult = await stagehand.act({
        action: "Click the link to the quickstart",
      });
      announce(
        `${chalk.green("Clicked the quickstart link using Stagehand AI fallback.")} \n${chalk.gray(
          actResult.message,
        )}`,
        "Act",
      );
    }
  }

  await stagehand.close();

  if (StagehandConfig.env === "BROWSERBASE") {
    console.log(
      "Session completed. Waiting for 10 seconds to see the logs and recording...",
    );
    //   Wait for 10 seconds to see the logs
    await new Promise((resolve) => setTimeout(resolve, 10000));
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
  } else {
    console.log(
      "We hope you enjoyed using Stagehand locally! On Browserbase, you can bypass captchas, replay sessions, and access unparalleled debugging tools!\n10 free sessions: https://www.browserbase.com/sign-up\n\n",
    );
  }

  console.log(
    `🤘 Thanks for using Stagehand! Create an issue if you have any feedback: ${chalk.blue(
      "https://github.com/browserbase/stagehand/issues/new",
    )}\n`,
  );
}

(async () => {
  await main().catch(console.error);
})();

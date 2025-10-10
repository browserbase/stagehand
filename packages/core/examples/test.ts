/* eslint-disable */
import { Stagehand } from "../../../dist";
import { Page } from "playwright";
import chalk from "chalk";
import { Browserbase } from "@browserbasehq/sdk";
import { writeFileSync } from "node:fs";
import { BrowserContext } from "playwright";
import StagehandConfig from "../stagehand.config";

async function saveDownloadsOnDisk(sessionId: string, retryForSeconds: number) {
  return new Promise<void>((resolve, reject) => {
    let pooler: any;
    const timeout = setTimeout(() => {
      if (pooler) {
        clearInterval(pooler);
      }
    }, retryForSeconds);

    async function fetchDownloads() {
      try {
        const bb = new Browserbase({
          apiKey: process.env.BROWSERBASE_API_KEY!,
        });
        const response = await bb.sessions.downloads.list(sessionId);
        const downloadBuffer = await response.arrayBuffer();

        if (downloadBuffer.byteLength > 0) {
          writeFileSync("downloads.zip", Buffer.from(downloadBuffer));
          clearInterval(pooler);
          clearTimeout(timeout);
          resolve();
        }
      } catch (e) {
        clearInterval(pooler);
        clearTimeout(timeout);
        reject(e);
      }
    }
    pooler = setInterval(fetchDownloads, 2000);
  });
}

/**
 * 🤘 Welcome to Stagehand! Thanks so much for trying us out!
 * 🛠️ CONFIGURATION: stagehand.config.ts will help you configure Stagehand
 *
 * 📝 Check out our docs for more fun use cases, like building agents
 * https://docs.stagehand.dev/
 *
 * 💬 If you have any feedback, reach out to us on Slack!
 * https://stagehand.dev/slack
 *
 * 📚 You might also benefit from the docs for Zod, Browserbase, and Playwright:
 * - https://zod.dev/
 * - https://docs.browserbase.com/
 * - https://playwright.dev/docs/intro
 */
async function main({
  page,
  context,
  stagehand,
}: {
  page: Page; // Playwright Page with act, extract, and observe methods
  context: BrowserContext; // Playwright BrowserContext
  stagehand: Stagehand; // Stagehand instance
}) {
  // Navigate to a URL
  await page.goto(
    "https://billofrightsinstitute.org/primary-sources/declaration-of-independence?gad_source=1&gad_campaignid=1461766925&gbraid=0AAAAAD-kVKqmqLRPIf5w6JtUk-Z_mf-wm&gclid=CjwKCAjw-svEBhB6EiwAEzSdrmgE_lM999n7bYMSSXdCuuKXaCIbLK-vDg-mJ03StSdJbcuXAGAN6hoCauEQAvD_BwE",
  );

  // Use act() to take actions on the page
  const agent = stagehand.agent({
    provider: "anthropic",
    model: "claude-3-7-sonnet-latest",
    instructions: "You are a helpful assistant that can use a web browser.",
    options: {
      apiKey: process.env.ANTHROPIC_API_KEY,
    },
  });

  await agent.execute({
    instruction:
      "Close any popups and then click on the download button. After clicking the download button, the task is complete.",
    maxSteps: 10,
  });
  await new Promise((resolve) => setTimeout(resolve, 10000));

  await saveDownloadsOnDisk(stagehand.browserbaseSessionID!, 20000); // wait up to 20s
  console.log("Downloaded files are in downloads.zip");

  stagehand.log({
    category: "create-browser-app",
    message: `Metrics`,
    auxiliary: {
      metrics: {
        value: JSON.stringify(stagehand.metrics),
        type: "object",
      },
    },
  });
}

/**
 * This is the main function that runs when you do npm run start
 *
 * YOU PROBABLY DON'T NEED TO MODIFY ANYTHING BELOW THIS POINT!
 *
 */
async function run() {
  const stagehand = new Stagehand({
    ...StagehandConfig,
    env: "LOCAL",
    useAPI: false,
  });
  await stagehand.init();

  const page = stagehand.page;
  const context = stagehand.context;
  await main({
    page,
    context,
    stagehand,
  });
  await stagehand.close();
  console.log(
    `\n🤘 Thanks so much for using Stagehand! Reach out to us on Slack if you have any feedback: ${chalk.blue(
      "https://stagehand.dev/slack",
    )}\n`,
  );
}

run();

import "dotenv/config";
import { Stagehand } from "@browserbasehq/stagehand";
import boxen from "boxen";
import chalk from "chalk";
import { z } from "zod";

async function main() {
  const stagehand = new Stagehand({
    /**
     * With npx create-browser-app, this config is found
     * in a separate stagehand.config.ts file
     */
    env: "BROWSERBASE", // Environment to run in: LOCAL or BROWSERBASE
    apiKey: process.env.BROWSERBASE_API_KEY /* API key for authentication */,
    projectId: process.env.BROWSERBASE_PROJECT_ID /* Project identifier */,

    // LLM configuration
    modelName: "google/gemini-2.0-flash" /* Name of the model to use */,
    modelClientOptions: {
      apiKey: process.env.GOOGLE_API_KEY,
    },
  });

  // Initialize the stagehand instance
  await stagehand.init();
  const page = stagehand.page;

  // If running in Browserbase, print a link to the session
  if (stagehand.env === "BROWSERBASE" && stagehand.browserbaseSessionID) {
    console.log(
      boxen(
        `View this session live in your browser: \n${`https://browserbase.com/sessions/${stagehand.browserbaseSessionID}`}`,
        {
          title: "Browserbase",
          padding: 1,
          margin: 3,
        },
      ),
    );
  }

  // Define the question and the URL of the docs
  const question = "Tell me, in one sentence, why I should use Stagehand";
  const docsUrl = "https://docs.stagehand.dev";

  // Navigate to the docs URL
  await page.goto(docsUrl);

  // Click on the search bar
  await page.act({
    action: "click on the search bar",
  });

  // Type the question into the search bar and click on the suggestion that says 'Use AI to answer your question'
  await page.act({
    action: `type '${question}' into the search bar and click on the suggestion that says 'Use AI to answer your question'`,
  });

  // Wait for 3 seconds
  await new Promise((resolve) => setTimeout(resolve, 3000));

  // Extract the response from the chatbot
  const { text } = await page.extract({
    instruction: "extract the response from the chatbot",
    schema: z.object({
      text: z.string(),
    }),
  });

  // Log the question and the answer
  console.log(
    "\n\n" +
      chalk.gray("Question: ") +
      question +
      "\n" +
      chalk.green("Answer from Mintlify AI: ") +
      text +
      "\n\n",
  );

  // Close the stagehand instance
  await stagehand.close();
}

main();

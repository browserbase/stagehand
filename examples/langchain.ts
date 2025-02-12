/**
 * This file is meant to be used as a scratchpad for developing new evals.
 * To create a Stagehand project with best practices and configuration, run:
 *
 * npx create-browser-app@latest my-browser-app
 */

import { Stagehand } from "../lib/index";
import StagehandConfig from "../stagehand.config";
import { LangchainClient } from "./external_clients/langchain";
import { z } from "zod";

async function example() {
  const stagehand = new Stagehand({
    env: "LOCAL",
    debugDom: true,
    enableCaching: false,
    llmClient: new LangchainClient({
      modelName: StagehandConfig.modelName,
      apiKey: StagehandConfig.modelClientOptions.apiKey,
    }),
  });

  await stagehand.init();

  await stagehand.page.goto("https://arxiv.org/search/");

  const observed = await stagehand.page.observe({
    instruction:
      "find the search bar with placeholder 'search term...' and fill it with the word 'hello'",
    onlyVisible: false,
    returnAction: true,
  });

  await stagehand.page.waitForTimeout(1000);
  
  await stagehand.page.act(observed[0]);

  await stagehand.page.waitForTimeout(1000);

  await stagehand.page.act("Click the search button");

  await stagehand.page.waitForTimeout(1000);

  const firstArticle = await stagehand.page.observe({
    instruction: "find the first arxiv article in the search results",
    onlyVisible: false,
    returnAction: true,
  });

  await stagehand.page.act(firstArticle[0]);

  const headlines = await stagehand.page.extract({
    instruction: "Extract the title and abstract of the arxiv article.",
    schema: z.object({
      title: z.string(),
      abstract: z.string(),
    }),
  });

  console.log(headlines);

  await stagehand.close();
}

(async () => {
  await example();
})();

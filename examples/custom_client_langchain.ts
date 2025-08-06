/**
 * This example shows how to use the Langchain client with Stagehand.
 *
 * You will need to reference the Langchain Client in /external_clients/langchain.ts
 */
import { z } from "zod/v3";
import { Stagehand } from "@browserbasehq/stagehand";
import StagehandConfig from "@/stagehand.config";
import { LangchainClient } from "./external_clients/langchain";
import { ChatOpenAI } from "@langchain/openai";

async function example() {
  const stagehand = new Stagehand({
    ...StagehandConfig,
    llmClient: new LangchainClient(
      new ChatOpenAI({
        model: "gpt-4o",
      }),
    ),
  });

  await stagehand.init();
  await stagehand.page.goto("https://news.ycombinator.com");

  const { story } = await stagehand.page.extract({
    schema: z.object({
      story: z.string().describe("the top story on the page"),
    }),
  });

  console.log("The top story is:", story);

  await stagehand.page.act("click the first story");

  await stagehand.close();
}

(async () => {
  await example();
})();

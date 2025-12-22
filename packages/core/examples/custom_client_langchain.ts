/**
 * This example shows how to use the Langchain client with Stagehand.
 *
 * You will need to reference the Langchain Client in /external_clients/langchain.ts
 */
import { z } from "zod";
import { Stagehand } from "../lib/v3";
import { LangchainClient } from "./external_clients/langchain";
import { ChatOpenAI } from "@langchain/openai";

async function example() {
  const stagehand = new Stagehand({
    env: "BROWSERBASE",
    verbose: 1,
    llmClient: new LangchainClient(
      new ChatOpenAI({
        model: "gpt-4o",
      }),
    ),
  });
  await stagehand.init();
  const page = stagehand.context.pages()[0];
  await page.goto("https://news.ycombinator.com");
  const { story } = await stagehand.extract(
    "extract the title of the top story on the page",
    z.object({
      story: z.string().describe("the top story on the page"),
    }),
  );
  console.log("The top story is:", story);
  await stagehand.act("click the first story");
  await stagehand.close();
}
(async () => {
  await example();
})();

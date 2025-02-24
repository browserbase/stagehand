import { z } from "zod";
import { Stagehand } from "@/dist";
import StagehandConfig from "@/stagehand.config";
import { LangchainClient } from "./external_clients/langchain";
import { ChatOpenAI } from "@langchain/openai";

async function example() {
  const stagehand = new Stagehand({
    ...StagehandConfig,
    llmClient: new LangchainClient(
      new ChatOpenAI({
        model: "gpt-4o",
      })
    )
  });

  await stagehand.init();
  await stagehand.page.goto("https://python.langchain.com/docs/introduction/");

  await stagehand.page.waitForTimeout(1000);

  const observation1 = await stagehand.page.observe({
    instruction: "Go to the Conceptual Guide section",
    returnAction: true,
  });
  if (observation1.length > 0) {
    await stagehand.page.act(observation1[0]);
  }

  await stagehand.page.waitForTimeout(1000);

  const observation2 = await stagehand.page.observe({
    instruction: "Click on 'Why LangChain?' located in the content of the page",
    returnAction: true,
  });
  if (observation2.length > 0) {
    await stagehand.page.act(observation2[0]);
  }

  await stagehand.page.waitForTimeout(1000);

  const result = await stagehand.page.extract({
    instruction: "Extract the first paragraph of the page",
    schema: z.object({
      content: z.string(),
    }),
  });

  console.log(result);

  await stagehand.page.waitForTimeout(5000);

  await stagehand.close();
}

(async () => {
  await example();
})();

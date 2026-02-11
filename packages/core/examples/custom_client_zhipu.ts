/**
 * This example shows how to use Z.ai (Zhipu AI) GLM models with Stagehand.
 *
 * Z.ai provides an OpenAI-compatible API with models like GLM-4.7.
 * GLM-4.7 has a built-in "thinking" mode for reasoning that is enabled by default.
 * The ZhipuOpenAIClient lets you control this via the `enableThinking` option.
 *
 * Set your ZHIPU_API_KEY in your .env file before running.
 */
import { Stagehand } from "../lib/v3";
import { z } from "zod";
import { ZhipuOpenAIClient } from "./external_clients/zhipuOpenAI";
import OpenAI from "openai";

async function example() {
  const stagehand = new Stagehand({
    env: "LOCAL",
    verbose: 1,
    llmClient: new ZhipuOpenAIClient({
      modelName: "glm-4.7",
      client: new OpenAI({
        apiKey: process.env.ZHIPU_API_KEY,
        baseURL: "https://api.z.ai/api/coding/paas/v4",
      }),
      // Set to true to enable GLM-4.7's thinking/reasoning mode.
      // Defaults to false (disabled) for lower latency and cost.
      enableThinking: false,
    }),
  });
  await stagehand.init();

  const page = stagehand.context.pages()[0];
  await page.goto("https://news.ycombinator.com");
  await stagehand.act("click on the 'new' link");

  const headlines = await stagehand.extract(
    "Extract the top 3 stories from the Hacker News homepage.",
    z.object({
      stories: z.array(
        z.object({
          title: z.string(),
          url: z.string(),
          points: z.number(),
        }),
      ),
    }),
  );

  console.log(headlines);

  await stagehand.close();
}

(async () => {
  await example();
})();

import { groq } from "@ai-sdk/groq";
import { defineAgent } from "eve";
import { mockModel } from "eve/evals";

const stagehandTool = "stagehand__code_execute";

export default defineAgent({
  modelContextWindowTokens: 131_072,
  model:
    process.env.EVE_STAGEHAND_DETERMINISTIC === "1"
      ? mockModel(({ toolResults, tools }) => {
          const stagehandResults = toolResults.filter(({ name }) => name === stagehandTool);

          if (!tools.some(({ name }) => name === stagehandTool)) {
            return {
              toolCalls: [
                {
                  name: "connection_search",
                  input: { connection: "stagehand", keywords: "execute browser JavaScript" },
                },
              ],
            };
          }

          if (stagehandResults.length === 0) {
            return {
              toolCalls: [
                {
                  name: stagehandTool,
                  input: {
                    code: `
                      await page.goto("https://example.com", {
                        waitUntil: "domcontentloaded",
                      });
                      await page.evaluate(() => {
                        document.documentElement.dataset.eveStagehandSmoke = "persistent";
                      });
                      return {
                        pageId: page.pageId,
                        title: await page.title(),
                        marker: await page.evaluate(
                          () => document.documentElement.dataset.eveStagehandSmoke,
                        ),
                      };
                    `,
                  },
                },
              ],
            };
          }

          return `STAGEHAND_RESULT ${JSON.stringify(stagehandResults.at(-1)?.output)}`;
        })
      : groq(process.env.EVE_STAGEHAND_MODEL ?? "openai/gpt-oss-120b"),
});

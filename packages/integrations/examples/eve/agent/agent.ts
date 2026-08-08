import { openai } from "@ai-sdk/openai";
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
                        document.documentElement.dataset.eveStagehandDirectMarker =
                          "eve-direct-persistent";
                      });
                      return {
                        pageId: page.pageId,
                        title: await page.title(),
                        directMarker: await page.evaluate(
                          () => document.documentElement.dataset.eveStagehandDirectMarker,
                        ),
                        modelKeyVisible: process.env.OPENAI_API_KEY ?? null,
                        hostMarkerVisible: process.env.EVE_HOST_ONLY_MARKER ?? null,
                      };
                    `,
                  },
                },
              ],
            };
          }

          if (stagehandResults.length === 1) {
            return {
              toolCalls: [
                {
                  name: stagehandTool,
                  input: {
                    code: `
                      const directMarker = await page.evaluate(
                        () => document.documentElement.dataset.eveStagehandDirectMarker,
                      );
                      if (directMarker !== "eve-direct-persistent") {
                        throw new Error("Eve lost Stagehand browser state between tool calls");
                      }
                      await page.evaluate(() => {
                        document.documentElement.dataset.eveStagehandModelMarker =
                          "eve-model-persistent";
                      });
                      return {
                        pageId: page.pageId,
                        title: await page.title(),
                        directMarker,
                        modelMarker: await page.evaluate(
                          () => document.documentElement.dataset.eveStagehandModelMarker,
                        ),
                        modelKeyVisible: process.env.OPENAI_API_KEY ?? null,
                        hostMarkerVisible: process.env.EVE_HOST_ONLY_MARKER ?? null,
                      };
                    `,
                  },
                },
              ],
            };
          }

          return `STAGEHAND_RESULTS ${JSON.stringify(stagehandResults.map(({ output }) => output))}`;
        })
      : openai(process.env.EVE_STAGEHAND_MODEL ?? "gpt-5-mini"),
});

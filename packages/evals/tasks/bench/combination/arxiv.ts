import { z } from "zod";
import { defineBenchTask } from "../../../framework/defineTask.js";

const paperDetailsSchema = z.object({
  category: z.string().describe("One of: Benchmark, Dataset, Model, Framework, System, or Other"),
  problem: z.string().describe("The problem the paper addresses in one sentence").nullable(),
  methodology: z.string().describe("The methodology in one sentence").nullable(),
  results: z.string().describe("The results in one sentence").nullable(),
  conclusion: z.string().describe("The conclusion in one sentence").nullable(),
  code: z.string().describe("A code repository URL, when provided").nullable(),
});

export default defineBenchTask(
  { name: "arxiv" },
  async ({ logger, debugUrl, sessionUrl, stagehand, page }) => {
    try {
      await page.goto("https://arxiv.org/search/");
      await stagehand.act("type web agents with multimodal models in the search bar");
      await stagehand.act("hit enter");

      const { data: paperLinks } = await stagehand.extract(
        "Extract the titles and links for two papers",
        z.object({
          papers: z.array(
            z.object({
              title: z.string().describe("The title of the paper"),
              link: z.string().url().describe("The link to the paper"),
            }),
          ),
        }),
      );

      const papers = [];
      for (const paper of paperLinks.papers.slice(0, 2)) {
        await page.goto(paper.link);
        const { data: abstract } = await stagehand.extract(
          "Extract details of the paper from the abstract",
          paperDetailsSchema,
        );
        papers.push({ ...paper, ...abstract });
      }

      const complete =
        papers.length === 2 && papers.every((paper) => paper.problem && paper.methodology);

      return {
        _success: complete,
        papers,
        logs: logger.getLogs(),
        debugUrl,
        sessionUrl,
      };
    } catch (error) {
      return {
        _success: false,
        error: error instanceof Error ? error.message : String(error),
        logs: logger.getLogs(),
        debugUrl,
        sessionUrl,
      };
    } finally {
      await stagehand.close();
    }
  },
);

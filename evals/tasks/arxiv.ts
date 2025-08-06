import { EvalFunction } from "@/types/evals";
import { z } from "zod/v3";

export const arxiv: EvalFunction = async ({
  logger,
  debugUrl,
  sessionUrl,
  stagehand,
}) => {
  try {
    await stagehand.page.goto("https://arxiv.org/search/");

    await stagehand.page.act(
      "type web agents with multimodal models in the search bar",
    );

    await stagehand.page.act("hit enter");

    const paper_links = await stagehand.page.extract({
      instruction: "extract the titles and links for two papers",
      schema: z.object({
        papers: z
          .array(
            z.object({
              title: z.string().describe("the title of the paper"),
              link: z.string().url().describe("the link to the paper"),
            }),
          )
          .describe("list of papers"),
      }),
    });

    if (
      !paper_links ||
      !paper_links.papers ||
      paper_links.papers.length === 0
    ) {
      return {
        _success: false,
        logs: logger.getLogs(),
        debugUrl,
        sessionUrl,
      };
    }

    const papers = [];
    for (const paper of paper_links.papers) {
      if (paper.link) {
        await stagehand.page.goto(paper.link);
        const abstract = await stagehand.page.extract({
          instruction: "extract details of the paper from the abstract",
          schema: z.object({
            category: z
              .string()
              .describe(
                "the category of the paper. one of {'Benchmark', 'Dataset', 'Model', 'Framework', 'System', 'Other'}",
              ),
            problem: z
              .string()
              .describe(
                "summarize the problem that the paper is trying to solve in one sentence",
              )
              .nullable(),
            methodology: z
              .string()
              .describe(
                "summarize the methodology of the paper in one sentence",
              )
              .nullable(),
            results: z
              .string()
              .describe("summarize the results of the paper in one sentence")
              .nullable(),
            conclusion: z
              .string()
              .describe("summarize the conclusion of the paper in one sentence")
              .nullable(),
            code: z
              .string()
              .describe(
                "if provided, extract only the link to the code repository, without additional text. this is often optional and not always provided.",
              )
              .nullable(),
          }),
        });

        papers.push({
          title: paper.title,
          link: paper.link,
          ...abstract,
        });
      }
    }

    if (!papers || papers.length === 0) {
      return {
        _success: false,
        logs: logger.getLogs(),
        debugUrl,
        sessionUrl,
      };
    }

    if (papers.length !== 2) {
      logger.error({
        message: "incorrect number of papers extracted",
        level: 0,
        auxiliary: {
          expected: {
            value: "2",
            type: "integer",
          },
          actual: {
            value: papers.length.toString(),
            type: "integer",
          },
        },
      });

      return {
        _success: false,
        error: "Incorrect number of papers extracted",
        logs: logger.getLogs(),
        debugUrl,
        sessionUrl,
      };
    }

    // Ensure that every paper has a problem and methodology
    for (const paper of papers) {
      if (!paper.problem || !paper.methodology) {
        logger.error({
          message: `paper missing problem or methodology`,
          level: 0,
          auxiliary: {
            paper: {
              value: JSON.stringify(paper),
              type: "object",
            },
          },
        });

        return {
          _success: false,
          error: "Incomplete paper information",
          logs: logger.getLogs(),
          debugUrl,
          sessionUrl,
        };
      }
    }

    return {
      _success: true,
      papers,
      logs: logger.getLogs(),
      debugUrl,
      sessionUrl,
    };
  } catch (error) {
    logger.error({
      message: `error in arxiv function`,
      level: 0,
      auxiliary: {
        error: {
          value: error.message,
          type: "string",
        },
        trace: {
          value: error.stack,
          type: "string",
        },
      },
    });

    return {
      _success: false,
      error: error,
      logs: logger.getLogs(),
      debugUrl,
      sessionUrl,
    };
  } finally {
    await stagehand.close();
  }
};

import { EvalFunction } from "@/types/evals";
import { z } from "zod/v3";

export const costar: EvalFunction = async ({
  logger,
  debugUrl,
  sessionUrl,
  stagehand,
}) => {
  try {
    await stagehand.page.goto("https://www.costar.com/");

    await stagehand.page.act({ action: "click on the first article" });

    await stagehand.page.act({
      action: "click on the learn more button for the first job",
    });

    const articleTitle = await stagehand.page.extract({
      instruction: "extract the title of the article",
      schema: z.object({
        title: z.string().describe("the title of the article").nullable(),
      }),
    });

    logger.log({
      message: "got article title",
      level: 1,
      auxiliary: {
        articleTitle: {
          value: JSON.stringify(articleTitle),
          type: "object",
        },
      },
    });

    // Check if the title is more than 5 characters
    const isTitleValid =
      articleTitle.title !== null && articleTitle.title.length > 5;

    await stagehand.close();

    return {
      title: articleTitle.title,
      _success: isTitleValid,
      debugUrl,
      sessionUrl,
      logs: logger.getLogs(),
    };
  } catch (error) {
    logger.error({
      message: "error in costar function",
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
      title: null,
      _success: false,
      error: error,
      debugUrl,
      sessionUrl,
      logs: logger.getLogs(),
    };
  } finally {
    await stagehand.close();
  }
};

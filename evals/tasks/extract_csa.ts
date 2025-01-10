import { EvalFunction } from "../../types/evals";
import { initStagehand } from "../initStagehand";
import { z } from "zod";

export const extract_csa: EvalFunction = async ({
  modelName,
  logger,
  useTextExtract,
}) => {
  const { stagehand, initResponse } = await initStagehand({
    modelName,
    logger,
  });

  const { debugUrl, sessionUrl } = initResponse;

  const { page } = stagehand;
  await page.goto(
    "https://clerk.assembly.ca.gov/weekly-histories?from_date=&to_date=2025-01-09",
  );

  const result = await page.extract({
    instruction:
      "Extract all the publications on the page including the publication date, session type, publication type, and annotation",
    schema: z.object({
      publications: z.array(
        z.object({
          publication_date: z.string(),
          session_type: z.string(),
          publication_type: z.string(),
          annotation: z.string(),
        }),
      ),
    }),
    modelName,
    useTextExtract,
  });

  await stagehand.close();

  const publications = result.publications;
  const expectedLength = 15;

  const expectedFirstItem = {
    publication_date: "12-20-2024",
    session_type: "Regular Session",
    publication_type: "Assembly Weekly History",
    annotation: "",
  };

  const expectedLastItem = {
    publication_date: "11-30-2016",
    session_type: "1st Extraordinary Session",
    publication_type: "Assembly Weekly History",
    annotation: "",
  };

  if (publications.length !== expectedLength) {
    logger.error({
      message: "Incorrect number of publications extracted",
      level: 0,
      auxiliary: {
        expected: {
          value: expectedLength.toString(),
          type: "integer",
        },
        actual: {
          value: publications.length.toString(),
          type: "integer",
        },
      },
    });
    return {
      _success: false,
      error: "Incorrect number of publications extracted",
      logs: logger.getLogs(),
      debugUrl,
      sessionUrl,
    };
  }
  const firstItemMatches =
    publications[0].publication_date === expectedFirstItem.publication_date &&
    publications[0].session_type === expectedFirstItem.session_type &&
    publications[0].publication_type === expectedFirstItem.publication_type &&
    publications[0].annotation === expectedFirstItem.annotation;

  if (!firstItemMatches) {
    logger.error({
      message: "First publication extracted does not match expected",
      level: 0,
      auxiliary: {
        expected: {
          value: JSON.stringify(expectedFirstItem),
          type: "object",
        },
        actual: {
          value: JSON.stringify(publications[0]),
          type: "object",
        },
      },
    });
    return {
      _success: false,
      error: "First publication extracted does not match expected",
      logs: logger.getLogs(),
      debugUrl,
      sessionUrl,
    };
  }

  const lastItemMatches =
    publications[publications.length - 1].publication_date ===
      expectedLastItem.publication_date &&
    publications[publications.length - 1].session_type ===
      expectedLastItem.session_type &&
    publications[publications.length - 1].publication_type ===
      expectedLastItem.publication_type &&
    publications[publications.length - 1].annotation ===
      expectedLastItem.annotation;

  if (!lastItemMatches) {
    logger.error({
      message: "Last publication extracted does not match expected",
      level: 0,
      auxiliary: {
        expected: {
          value: JSON.stringify(expectedLastItem),
          type: "object",
        },
        actual: {
          value: JSON.stringify(publications[publications.length - 1]),
          type: "object",
        },
      },
    });
    return {
      _success: false,
      error: "Last publication extracted does not match expected",
      logs: logger.getLogs(),
      debugUrl,
      sessionUrl,
    };
  }

  return {
    _success: true,
    logs: logger.getLogs(),
    debugUrl,
    sessionUrl,
  };
};

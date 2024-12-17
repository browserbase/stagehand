import { EvalFunction } from "../../types/evals";
import { initStagehand } from "../initStagehand";
import { z } from "zod";

export const extract_research_reports: EvalFunction = async ({
  modelName,
  logger,
  useTextExtract,
}) => {
  const { stagehand, initResponse } = await initStagehand({
    modelName,
    logger,
  });

  const { debugUrl, sessionUrl } = initResponse;

  await stagehand.init();
  await stagehand.page.goto(
    "http://www.dsbd.gov.za/index.php/research-reports",
    { waitUntil: "load" },
  );

  const result = await stagehand.page.extract({
    instruction:
      "Extract ALL the research report names. Do not extract the names of the PDF attachments.",
    schema: z.object({
      reports: z.array(
        z.object({
          report_name: z
            .string()
            .describe(
              "The name or title of the research report. NOT the name of the PDF attachment.",
            ),
        }),
      ),
    }),
    modelName,
    useTextExtract,
  });

  await stagehand.close();

  const reports = result.reports;
  const expectedLength = 9;

  const expectedFirstItem = {
    report_name:
      "Longitudinal Study on SMMEs and Co-operatives in South Africa and the study on the Eastern SeaBoard",
  };

  const expectedLastItem = {
    report_name: "Research Agenda",
  };

  if (reports.length !== expectedLength) {
    logger.error({
      message: "Incorrect number of reports extracted",
      level: 0,
      auxiliary: {
        expected: {
          value: expectedLength.toString(),
          type: "integer",
        },
        actual: {
          value: reports.length.toString(),
          type: "integer",
        },
      },
    });
    return {
      _success: false,
      error: "Incorrect number of reports extracted",
      logs: logger.getLogs(),
      debugUrl,
      sessionUrl,
    };
  }
  const firstItemMatches =
    reports[0].report_name === expectedFirstItem.report_name;

  if (!firstItemMatches) {
    logger.error({
      message: "First report extracted does not match expected",
      level: 0,
      auxiliary: {
        expected: {
          value: JSON.stringify(expectedFirstItem),
          type: "object",
        },
        actual: {
          value: JSON.stringify(reports[0]),
          type: "object",
        },
      },
    });
    return {
      _success: false,
      error: "First report extracted does not match expected",
      logs: logger.getLogs(),
      debugUrl,
      sessionUrl,
    };
  }

  const lastItemMatches =
    reports[reports.length - 1].report_name === expectedLastItem.report_name;

  if (!lastItemMatches) {
    logger.error({
      message: "Last report extracted does not match expected",
      level: 0,
      auxiliary: {
        expected: {
          value: JSON.stringify(expectedLastItem),
          type: "object",
        },
        actual: {
          value: JSON.stringify(reports[reports.length - 1]),
          type: "object",
        },
      },
    });
    return {
      _success: false,
      error: "Last report extracted does not match expected",
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

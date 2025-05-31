import { EvalFunction } from "@/types/evals";
import { z } from "zod";

export const google_jobs: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  stagehand,
  logger,
}) => {
  try {
    await stagehand.page.goto("https://www.google.com/");
    await stagehand.page.act("click on the about page");
    await stagehand.page.act("click on the careers page");
    await stagehand.page.act("input data scientist into role");
    await stagehand.page.act("input new york city into location");
    await stagehand.page.act("click on the search button");
    await stagehand.page.act("click on the first job link");

    const jobDetails = await stagehand.page.extract({
      instruction:
        "Extract the following details from the job posting: application deadline, minimum qualifications (degree and years of experience), and preferred qualifications (degree and years of experience)",
      schema: z.object({
        applicationDeadline: z
          .string()
          .describe("The date until which the application window will be open")
          .nullable(),
        minimumQualifications: z.object({
          degree: z.string().describe("The minimum required degree").nullable(),
          yearsOfExperience: z
            .number()
            .describe("The minimum required years of experience")
            .nullable(),
        }),
        preferredQualifications: z.object({
          degree: z.string().describe("The preferred degree").nullable(),
          yearsOfExperience: z
            .number()
            .describe("The preferred years of experience")
            .nullable(),
        }),
      }),
    });

    const isJobDetailsValid =
      jobDetails &&
      Object.values(jobDetails).every(
        (value) =>
          value !== null &&
          value !== undefined &&
          (typeof value !== "object" ||
            Object.values(value).every(
              (v) =>
                v !== null &&
                v !== undefined &&
                (typeof v === "number" || typeof v === "string"),
            )),
      );

    await stagehand.close();

    return {
      _success: isJobDetailsValid,
      jobDetails,
      debugUrl,
      sessionUrl,
      logs: logger.getLogs(),
    };
  } catch (error) {
    logger.error({
      message: "error in google_jobs function",
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

    await stagehand.close();

    return {
      _success: false,
      debugUrl,
      sessionUrl,
      error: JSON.parse(JSON.stringify(error, null, 2)),
      logs: logger.getLogs(),
    };
  }
};

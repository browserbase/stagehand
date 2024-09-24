import { Eval } from "braintrust";
import { Stagehand } from "../lib";
import { z } from "zod";

const google_jobs = async () => {
  const stagehand = new Stagehand({
    env: "LOCAL",
    verbose: true,
    debugDom: true,
  });
  await stagehand.init({ modelName: "gpt-4o-2024-08-06" });

  await stagehand.page.goto("https://www.google.com/");
  await stagehand.waitForSettledDom();

  await stagehand.act({ action: "click on the about page" });

  await stagehand.act({ action: "click on the careers page" });

  await stagehand.act({ action: "input data scientist into role" });

  await stagehand.act({ action: "input new york city into location" });

  await stagehand.act({ action: "click on the search button" });

  await stagehand.act({
    action: "click on the learn more button for the first job",
  });

  const jobDetails = await stagehand.extract({
    instruction:
      "Extract the following details from the job posting: application deadline, minimum qualifications (degree and years of experience), and preferred qualifications (degree and years of experience)",
    schema: z.object({
      applicationDeadline: z
        .string()
        .describe("The date until which the application window will be open"),
      minimumQualifications: z.object({
        degree: z.string().describe("The minimum required degree"),
        yearsOfExperience: z
          .number()
          .describe("The minimum required years of experience"),
      }),
      preferredQualifications: z.object({
        degree: z.string().describe("The preferred degree"),
        yearsOfExperience: z
          .number()
          .describe("The preferred years of experience"),
      }),
    }),
    modelName: "gpt-4o-2024-08-06",
  });

  console.log("Job Details:", jobDetails);

  const isJobDetailsValid =
    jobDetails &&
    Object.values(jobDetails).every(
      (value) =>
        value !== null &&
        value !== undefined &&
        value !== "" &&
        (typeof value !== "object" ||
          Object.values(value).every(
            (v) =>
              v !== null &&
              v !== undefined &&
              v !== "" &&
              (typeof v === "number" || typeof v === "string"),
          )),
    );

  await stagehand.context.close();

  console.log("Job Details valid:", isJobDetailsValid);

  return isJobDetailsValid;
};

async function main() {
  const [googleJobsResult] = await Promise.all([google_jobs()]);

  console.log("Google Jobs result:", googleJobsResult);
}

main().catch(console.error);

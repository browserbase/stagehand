import { Eval } from "braintrust";
import { Stagehand } from "../lib";
import { z } from "zod";

const costar = async () => {
  const stagehand = new Stagehand({ env: "LOCAL", verbose: 2, debugDom: true, headless: process.env.HEADLESS !== 'false' });
  await stagehand.init();
  // TODO: fix this eval - it works only on some days depending on the article
  try {
    await Promise.race([
      stagehand.page.goto("https://www.costar.com/"),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Navigation timeout')), 30000))
    ]);
    await stagehand.waitForSettledDom();

    await stagehand.act({ action: "click on the first article" });

    await stagehand.act({ action: "find the footer of the page" });

    await stagehand.waitForSettledDom();
    const articleTitle = await stagehand.extract({
      instruction: "extract the title of the article",
      schema: z.object({
        title: z.string().describe("the title of the article").nullable(),
      }),
      modelName: "gpt-4o-2024-08-06"
    });

    console.log("articleTitle", articleTitle);

    // Check if the title is more than 5 characters
    const isTitleValid = articleTitle.title !== null && articleTitle.title.length > 5;
  
    await stagehand.context.close();
  
    return isTitleValid;

  } catch (error) {
    console.error(`Error in costar function: ${error.message}`);
    return { title: null };
  } finally {
    await stagehand.context.close();
  }
};

const google_jobs = async () => {
  const stagehand = new Stagehand({ env: "LOCAL", verbose: 2, debugDom: true, headless: process.env.HEADLESS !== 'false' });
  await stagehand.init({ modelName: "gpt-4o-2024-08-06" });

  await stagehand.page.goto("https://www.google.com/");
  await stagehand.waitForSettledDom();

  await stagehand.act({ action: "click on the about page" });

  await stagehand.act({ action: "click on the careers page" });

  await stagehand.act({ action: "input data scientist into role" });

  await stagehand.act({ action: "input new york city into location" });

  await stagehand.act({ action: "click on the search button" });
  // NOTE: "click on the first Learn More button" is not working - the span for learn more is not clickable and the a href is after it
  await stagehand.act({ action: "click on the first job link" });

  const jobDetails = await stagehand.extract({
    instruction: "Extract the following details from the job posting: application deadline, minimum qualifications (degree and years of experience), and preferred qualifications (degree and years of experience)",
    schema: z.object({
      applicationDeadline: z.string().describe("The date until which the application window will be open"),
      minimumQualifications: z.object({
        degree: z.string().describe("The minimum required degree"),
        yearsOfExperience: z.number().describe("The minimum required years of experience")
      }),
      preferredQualifications: z.object({
        degree: z.string().describe("The preferred degree"),
        yearsOfExperience: z.number().describe("The preferred years of experience")
      })
    }),
    modelName: "gpt-4o-2024-08-06"
  });

  console.log("Job Details:", jobDetails);

  const isJobDetailsValid = jobDetails && 
  Object.values(jobDetails).every(value => 
    value !== null && 
    value !== undefined && 
    (typeof value !== 'object' || Object.values(value).every(v => 
      v !== null && 
      v !== undefined && 
      (typeof v === 'number' || typeof v === 'string')
    ))
  );

  await stagehand.context.close();

  console.log("Job Details valid:", isJobDetailsValid);

  return isJobDetailsValid;
};

async function main() {
  const [googleJobsResult] = await Promise.all([
    google_jobs(),
  ]);
  
  console.log("Google jobs result:", googleJobsResult);
}

main().catch(console.error);
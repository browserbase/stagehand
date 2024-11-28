import { Stagehand } from "@browserbasehq/stagehand";
import { z } from "zod";

(async () => {
  const stagehand = new Stagehand({
    env: "LOCAL",
    verbose: 1,
    debugDom: true,
    enableCaching: false,
  });

  await stagehand.init({ modelName: "gpt-4" });
  await stagehand.page.goto("https://aigrant.com/");
  const companyList = await stagehand.extract({
    instruction: "Extract all companies that received " +
    "the AI grant and group them with their batch numbers " +
    "as an array of objects. Each object should contain " +
    "the company name and its corresponding batch number.",
    schema: z.object({
      companies: z.array(
        z.object({
          company: z.string(),
          batch: z.string(),
        })
      ),
    }),
  });

  console.log("The list of companies and their batch numbers are:");
  console.log(JSON.stringify(companyList, null, 2));
})();

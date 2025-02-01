import { test, expect } from "@playwright/test";
import { Stagehand } from "../../../../lib";
import StagehandConfig from "../../stagehand.config";
import { z } from "zod";

test.describe("StagehandPage - content", () => {
  test("should retrieve the full HTML content of the page", async () => {
    test.setTimeout(180_000);
    const stagehand = new Stagehand({
      ...StagehandConfig,
      modelName: "o1",
    });
    await stagehand.init();

    const page = stagehand.page;
    await page.goto("https://www.google.com");
    await page.act({
      action: "search for browserbase & go to their website",
    });

    const result = await page.extract({
      instruction: "extract the name of the company",
      schema: z.object({
        companyName: z.string(),
      }),
    });

    console.log(result);
    expect(result.companyName.toLowerCase().trim()).toContain("browserbase");

    await stagehand.close();
  });
});

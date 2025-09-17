import { V3 } from "../lib/v3/v3";
import { z } from "zod/v3";

async function example(v3: V3) {
  const page = v3.context.pages()[0];
  await page.goto(
    "https://browserbase.github.io/stagehand-eval-sites/sites/aigrant/",
  );
  const startTime = Date.now();
  const companyList = await v3.extract({
    instruction:
      "Extract ALL companies that received the AI grant. Each object should contain the company name and its corresponding batch number. MAKE SURE YOU GET ALL FOUR BATCHES.",
    schema: z.object({
      companies: z.array(
        z.object({
          company: z.string(),
          batch: z.string(),
        }),
      ),
    }),
  });
  console.log(companyList.companies);
  console.log(`endTime: ${Date.now() - startTime}`);

  // /html[1]/body[1]/div[6]/div[1]/header/nav/div[1]/div/div[2]/div[1]/form/div[1]/div[2]/input
  // /html[1]/body[1]/div[5]/div[1]/header[1]/nav[1]/div[1]/div[1]/div[1]/div[3]/div[1]/form[1]/div[1]/div[2]/input[1]
}

(async () => {
  const v3 = new V3({
    env: "LOCAL",
    localBrowserLaunchOptions: {
      headless: false,
      args: ["--window-size=1400,300"],
    },
    verbose: 1,
    modelName: "google/gemini-2.5-flash-lite",
    // includeCursor: true,
  });
  await v3.init();
  await example(v3);
})();

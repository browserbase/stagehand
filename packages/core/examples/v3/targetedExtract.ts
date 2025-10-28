import { Stagehand } from "../../lib/v3";
import { z } from "zod";

async function example(stagehand: Stagehand) {
  const page = stagehand.context.pages()[0];
  await page.goto(
    "https://browserbase.github.io/stagehand-eval-sites/sites/jfk/",
  );

  const extraction = await stagehand.extract(
    "extract all the record file name and their corresponding links",
    z.object({
      records: z.array(
        z.object({
          file_name: z.string().describe("the file name of the record"),
          link: z.url().describe("the link to the record"),
        }),
      ),
    }),
  );
  console.log(extraction);
}

(async () => {
  const stagehand = new Stagehand({
    env: "LOCAL",
    verbose: 0,
    model: "openai/gpt-4.1",
    logInferenceToFile: true,
  });
  await stagehand.init();
  await example(stagehand);
})();

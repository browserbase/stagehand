import { Stagehand } from "../../lib/v3";
import { z } from "zod";

async function example(stagehand: Stagehand) {
  const page = stagehand.context.pages()[0];
  await page.goto(
    "https://browserbase.github.io/stagehand-eval-sites/sites/jfk/",
  );

  const extraction = await stagehand.extract(
    "extract all the links to the filenames",
    z.object({
      records: z.array(z.url().describe("the link to the record")),
    }),
  );
  console.log(extraction);
}
(async () => {
  const stagehand = new Stagehand({
    env: "LOCAL",
    verbose: 0,
    model: "google/gemini-2.5-flash",
    logInferenceToFile: true,
  });
  await stagehand.init();
  await example(stagehand);
})();

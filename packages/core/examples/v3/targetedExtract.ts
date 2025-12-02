import { Stagehand } from "../../lib/v3";
import { z } from "zod";

async function example(stagehand: Stagehand) {
  const page = stagehand.context.pages()[0];
  await page.goto(
    "https://ambarc.github.io/web-element-test/stagehand-breaking-test.html",
  );

  await page
    .deepLocator("/html/body/div[2]/div[3]/iframe/html/body/p")
    .highlight({
      durationMs: 5000,
      contentColor: { r: 255, g: 0, b: 0 },
    });

  const reason = await stagehand.extract(
    "extract the reason why script injection fails",
    z.string(),
    // selector: "// body > div.test-container > div:nth-child(3) > iframe >> body > p:nth-child(3)",
    { selector: "/html/body/div[2]/div[3]/iframe/html/body/p[2]" },
  );
  console.log(reason);
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

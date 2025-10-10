import { Stagehand } from "../../lib/v3";

async function example(stagehand: Stagehand) {
  const page = stagehand.context.pages()[0];
  await page.goto(
    "https://browserbase.github.io/stagehand-eval-sites/sites/closed-shadow-root-in-oopif/",
  );

  await page
    .deepLocator(
      "xpath=/html/body/main/section/iframe/html/body/shadow-demo//div/button",
    )
    .highlight({
      durationMs: 20000,
      contentColor: { r: 255, g: 0, b: 0 },
    });
}

(async () => {
  const stagehand = new Stagehand({
    env: "LOCAL",
    verbose: 0,
    model: "google/gemini-2.5-flash",
  });
  await stagehand.init();
  await example(stagehand);
})();

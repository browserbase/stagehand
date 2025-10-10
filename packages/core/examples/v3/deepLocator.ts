import { Stagehand } from "../../lib/v3";

async function example(stagehand: Stagehand) {
  const page = stagehand.context.pages()[0];
  await page.goto(
    "https://browserbase.github.io/stagehand-eval-sites/sites/oopif-in-closed-shadow-dom/",
  );

  // crossing OOPIF & shadow root boundaries with deep locator
  await page
    .deepLocator(
      "/html/body/shadow-host//section/iframe/html/body/main/section[1]/form/div/div[1]/input",
    )
    .fill("nunya");
  await page
    .deepLocator(
      "/html/body/shadow-host//section/iframe/html/body/main/section[1]/form/div/div[2]/input",
    )
    .fill("business");
}

(async () => {
  const stagehand = new Stagehand({
    env: "LOCAL",
    verbose: 0,
    model: "openai/gpt-4.1",
  });
  await stagehand.init();
  await example(stagehand);
})();

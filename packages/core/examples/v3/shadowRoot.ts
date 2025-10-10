import { Stagehand } from "../../lib/v3";

async function example(stagehand: Stagehand) {
  const page = stagehand.context.pages()[0];
  await page.goto(
    "https://browserbase.github.io/stagehand-eval-sites/sites/shadow-dom-closed/",
  );

  // clicking in closed mode shadow root with an xpath
  await page.locator("/html/body/shadow-demo//div/button").click();

  await new Promise((resolve) => setTimeout(resolve, 3000));

  await page.reload();
  await new Promise((resolve) => setTimeout(resolve, 3000));

  // clicking in closed mode shadow root with css selector
  await page.locator("div > button").click();
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

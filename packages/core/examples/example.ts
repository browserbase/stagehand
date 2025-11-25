import { Stagehand } from "../lib/v3";

async function example(stagehand: Stagehand) {
  /**
   * Add your code here!
   */
  const page = stagehand.context.pages()[0];
  await page.goto(
    "https://browserbase.github.io/stagehand-eval-sites/sites/iframe-hn/",
  );
}

(async () => {
  const stagehand = new Stagehand({
    env: "LOCAL",
    verbose: 2,
  });
  await stagehand.init();
  await example(stagehand);
})();

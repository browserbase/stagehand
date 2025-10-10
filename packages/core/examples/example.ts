import { Stagehand } from "../lib/v3";

async function example(stagehand: Stagehand) {
  /**
   * Add your code here!
   */
  const page = stagehand.context.pages()[0];
  await page.goto(
    "https://browserbase.github.io/stagehand-eval-sites/sites/iframe-hn/",
  );
  const { extraction } = await stagehand.extract(
    "grab the the first title from inside the iframe",
  );
  console.log(extraction);
}

(async () => {
  const stagehand = new Stagehand({
    env: "LOCAL",
    experimental: true,
    verbose: 1,
  });
  await stagehand.init();
  await example(stagehand);
})();

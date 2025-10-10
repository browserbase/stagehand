import { Stagehand } from "../../lib/v3";

async function example(stagehand: Stagehand) {
  const page = stagehand.context.pages()[0];
  await page.goto(
    "https://browserbase.github.io/stagehand-eval-sites/sites/oopif-in-closed-shadow-dom/",
  );

  const xpath = await page.click(286, 628, { returnXpath: true });

  // use the xpath that was returned from out coord click
  await page.deepLocator(xpath).fill("hellooooooooo");
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

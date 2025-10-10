import { Stagehand } from "../../lib/v3";

async function example(stagehand: Stagehand) {
  const page = stagehand.context.pages()[0];
  await page.goto(
    "https://browserbase.github.io/stagehand-eval-sites/sites/scroll-dropdown/",
  );

  const actResult = await stagehand.act(
    "choose 'Peach' from the favorite colour dropdown",
  );

  const numSteps = actResult.actions.length;

  console.log(
    `\n\nThis act() call took ${numSteps} steps. Here are the actions:`,
  );

  for (const action of actResult.actions) {
    console.log(`\naction: `, action);
  }
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

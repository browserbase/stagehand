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

  const page2 = await stagehand.context.newPage();
  await page2.goto(
    "https://browserbase.github.io/stagehand-eval-sites/sites/iframe-same-proc/",
  );
  await stagehand.extract(
    "extract the placeholder text on the your name field",
    { page: page2 },
  );
  await stagehand.act("fill the your name field with the text 'John Doe'", {
    page: page2,
  });
  const action2 = await stagehand.observe(
    "select blue as the favorite color on the dropdown",
    { page: page2 },
  );
  action2.map(async (action) => {
    await stagehand.act(action);
  });
}

(async () => {
  const stagehand = new Stagehand({
    env: "BROWSERBASE",
    verbose: 2,
  });
  await stagehand.init();
  await example(stagehand);
})();

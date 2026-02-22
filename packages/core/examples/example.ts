import { Stagehand } from "../lib/v3/index.js";

const stagehand = new Stagehand({
  env: "BROWSERBASE",
  apiKey: process.env.BROWSERBASE_API_KEY,
  projectId: process.env.BROWSERBASE_PROJECT_ID,
  model: {
    modelName: "openai/gpt-5",
    apiKey: process.env.MODEL_API_KEY,
  },
  verbose: 2,
});

try {
  await stagehand.init();

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
  for (const action of action2) {
    await stagehand.act(action, { page: page2, timeout: 30_000 });
  }
} finally {
  await stagehand.close();
}

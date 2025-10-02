import { V3 } from "@browserbasehq/stagehand";

async function example(v3: V3) {
  const page = v3.context.pages()[0];
  await page.goto("https://github.com/microsoft/playwright/issues/30261");
  await v3.act("scroll to the bottom of the page", { page: page });

  // await page.locator("xpath=/html").scrollTo(100)
}

(async () => {
  const v3 = new V3({
    env: "LOCAL",
    verbose: 2,
    logInferenceToFile: false,
    model: "openai/gpt-4.1",
    cacheDir: "stagehand-act-cache",
  });
  await v3.init();
  await example(v3);
})();

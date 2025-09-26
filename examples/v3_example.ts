import { V3 } from "@browserbasehq/stagehand";

async function example(v3: V3) {
  const page = v3.context.pages()[0];
  await page.goto("https://github.com/microsoft/playwright/issues/30261");
  await v3.act({
    instruction: "scroll to the bottom of the page",
    page: page,
  });

  // await page.locator("xpath=/html").scrollTo(100)
}

(async () => {
  const v3 = new V3({
    env: "LOCAL",
    localBrowserLaunchOptions: {
      headless: false,
      downloadsPath: "downloads",
      acceptDownloads: true,
    },
    verbose: 0,
    modelName: "openai/gpt-4.1",
    logInferenceToFile: false,
    // includeCursor: true,
  });
  await v3.init();
  await example(v3);
})();

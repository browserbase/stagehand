import { V3 } from "@browserbasehq/stagehand";

async function example(v3: V3) {
  const page = v3.context.pages()[0];
  await page.goto(
    "https://browserbase.github.io/stagehand-eval-sites/sites/download-on-click/",
  );

  await page.locator("/html/body/button").click();
}

(async () => {
  const v3 = new V3({
    env: "LOCAL",
    localBrowserLaunchOptions: {
      headless: false,
      downloadsPath: "downloads",
      acceptDownloads: true,
    },
    verbose: 1,
    modelName: "google/gemini-2.5-flash-lite",
    // includeCursor: true,
  });
  await v3.init();
  await example(v3);
})();

import { Stagehand } from "../lib/v3";

async function example(stagehand: Stagehand) {
  /**
   * Add your code here!
   */
  const page = stagehand.context.pages()[0];
  await page.goto(
    "https://browserbase.github.io/stagehand-eval-sites/sites/iframe-hn/",
    { waitUntil: "networkidle" },
  );

  const centroid = await page.locator("xpath=/html/body").centroid();
  console.log(centroid);

  await stagehand.close();

  // throw new Error("BBERRROR")
  // process.kill(process.pid, "SIGINT");
}

(async () => {
  const stagehand = new Stagehand({
    env: "BROWSERBASE",
    verbose: 2,
    // disableAPI: true,
    // disablePino: true,
    keepAlive: true,
    // browserbaseSessionCreateParams: {
    //   keepAlive: false
    // }
  });
  await stagehand.init();
  await example(stagehand);
})();

import { localBrowser, Stagehand } from "../src/index.js";

const webMCPTestSite = "https://browserbase.github.io/stagehand-eval-sites/sites/webmcp-test/";

const browser = await localBrowser.launch({ headless: false });
const stagehand = await Stagehand.create({ browser });

const [page] = await browser.context.pages();
await page.goto(webMCPTestSite);

const tools = await page.tools({ timeout: 5_000 });
const calculateSum = tools.find((tool) => tool.name === "calculateSum");
if (!calculateSum) {
  throw new Error("calculateSum was not registered by the page");
}

const invocation = await calculateSum.invoke({
  input: { a: 19, b: 23 },
});
const result = await invocation.result();

console.log(result);

await stagehand.close();
await browser.close();

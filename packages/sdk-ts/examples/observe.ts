import "dotenv/config";
import { localBrowser, Stagehand } from "../src/index.js";

const { OPENAI_API_KEY } = process.env;
if (!OPENAI_API_KEY) throw new Error();

const browser = await localBrowser.launch({ headless: true });
const stagehand = await Stagehand.create({
  browser,
  model: {
    modelName: "openai/gpt-5.4-mini",
    apiKey: OPENAI_API_KEY,
  },
});

const page = await stagehand.context.activePage();
if (!page) {
  throw new Error("Stagehand initialized without an active page");
}
await page.goto("https://example.com");

const actions = await stagehand.observe(
  "Find the link that provides more information about Example Domain",
);

console.log(JSON.stringify(actions, null, 2));

if (actions.data.length === 0) {
  throw new Error("observe() returned no matching actions");
}

await stagehand.close();
await browser.close();

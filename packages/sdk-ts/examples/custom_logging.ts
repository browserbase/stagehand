import "dotenv/config";
import { createWriteStream } from "node:fs";
import { finished } from "node:stream/promises";
import { localBrowser, Stagehand } from "../src/index.js";

const { OPENAI_API_KEY } = process.env;
if (!OPENAI_API_KEY) throw new Error();

const logFile = createWriteStream("stagehand.jsonl", { flags: "a" });

const browser = await localBrowser.launch({ headless: true });
const stagehand = await Stagehand.create({
  browser,
  model: {
    modelName: "openai/gpt-5.4-mini",
    apiKey: OPENAI_API_KEY,
  },
  logging: {
    level: "info",
    format: "pretty",
    onLog(log) {
      logFile.write(`${JSON.stringify(log)}\n`);
    },
  },
});

const page = await stagehand.context.activePage();
if (!page) throw new Error();

await page.goto("https://example.com");
console.log(await stagehand.observe("Find the Learn more link"));

await stagehand.close();
await browser.close();
logFile.end();
await finished(logFile);

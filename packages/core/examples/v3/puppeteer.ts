import { Stagehand } from "../../lib/v3/index.js";
import puppeteer from "puppeteer-core";

const stagehand = new Stagehand({
  env: "LOCAL",
  verbose: 0,
  model: "openai/gpt-4.1",
});

await stagehand.init();

const browser = await puppeteer.connect({
  browserWSEndpoint: stagehand.connectURL(),
  defaultViewport: null,
});
const ppPages = await browser.pages();
const ppPage = ppPages[0];

await ppPage.goto("https://www.browserbase.com/blog");

const actions = await stagehand.observe("find the next page button", {
  page: ppPage,
});

await stagehand.act(actions[0]);

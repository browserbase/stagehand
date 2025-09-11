import V3 from "../lib/v3/v3.js";
import puppeteer from "puppeteer-core";

const v3 = new V3({
  env: "LOCAL",
  headless: false,
  verbose: 0,
});
await v3.init();
const puppeteerBrowser = await puppeteer.connect({
  browserWSEndpoint: v3.connectURL(),
});
const puppeteerPages = await puppeteerBrowser.pages();

const page = puppeteerPages[0];

await page.goto(
  "https://browserbase.github.io/stagehand-eval-sites/sites/closed-shadow-root-in-oopif/",
);

const observeResult = {
  selector:
    "xpath=/html/body/main/section/iframe/html/body/shadow-demo//div/button",
  method: "click",
  description: "nunya",
  arguments: [""],
};

await new Promise((resolve) => setTimeout(resolve, 200));
await v3.act(observeResult, page);

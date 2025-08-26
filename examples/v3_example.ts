import { V3 } from "../lib/v3/v3";
import puppeteer from "puppeteer-core";

async function example(v3: V3) {
  const puppeteerBrowser = await puppeteer.connect({
    browserWSEndpoint: v3.connectURL(),
  });
  const puppeteerPages = await puppeteerBrowser.pages();
  const puppeteerPage = puppeteerPages[0];

  await puppeteerPage.goto(
    "https://browserbase.github.io/stagehand-eval-sites/sites/no-js-click/",
  );

  await v3.act({ instruction: "click the button", page: puppeteerPage });
}

(async () => {
  const v3 = new V3({
    env: "LOCAL",
    headless: false,
    verbose: 2,
  });
  await v3.init();
  await example(v3);
})();

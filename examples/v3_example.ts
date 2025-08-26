import { V3 } from "../lib/v3/v3";
import puppeteer from "puppeteer-core";

async function example(v3: V3) {
  const puppeteerBrowser = await puppeteer.connect({
    browserWSEndpoint: v3.connectURL(),
  });
  const puppeteerPages = await puppeteerBrowser.pages();
  const puppeteerPage = puppeteerPages[0];

  await puppeteerPage.goto(
    "https://browserbase.github.io/stagehand-eval-sites/sites/iframe-form-filling/",
  );

  // await v3.act({ instruction: "click the button", page: puppeteerPage });

  await new Promise((resolve) => setTimeout(resolve, 5000));
  const observeResult = {
    method: "click",
    description: "nunya",
    selector:
      "/html/body/div/iframe/html/body/main/section[1]/form/fieldset/label[2]/input",
    arguments: [""],
  };

  await v3.act(observeResult, puppeteerPage);
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

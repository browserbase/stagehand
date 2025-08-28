import { V3 } from "../lib/v3/v3";
import puppeteer from "puppeteer-core";

async function example(v3: V3) {
  const puppeteerBrowser = await puppeteer.connect({
    browserWSEndpoint: v3.connectURL(),
  });
  const puppeteerPages = await puppeteerBrowser.pages();
  const puppeteerPage = puppeteerPages[0];

  await puppeteerPage.goto("https://www.quicken.com/support/search-opt/", {
    waitUntil: "load",
  });

  // await v3.act({ instruction: "click the button", page: puppeteerPage });

  await new Promise((resolve) => setTimeout(resolve, 10000));
  // const observeResult = {
  //   method: "click",
  //   description: "nunya",
  //   selector:
  //     "/html/body/div/iframe/html/body/main/section[1]/form/fieldset/label[2]/input",
  //   arguments: [""],
  // };

  // await v3.act(observeResult, puppeteerPage);

  await v3.act({ instruction: "close the cookie", page: puppeteerPage });
  await v3.act({
    instruction: "Click on 'chat now'",
    page: puppeteerPage,
  });
  await v3.act({
    instruction: "Click the div that says 'Send us a message'",
    page: puppeteerPage,
  });
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

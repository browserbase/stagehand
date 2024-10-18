import { Stagehand } from "../lib";
import { z } from "zod";

async function example() {
  const stagehand = new Stagehand({
    env: "LOCAL",
    verbose: 1,
    debugDom: true,
    iframeSupport: true, // Set to true to enable iframe scanning
  });
  
  await stagehand.init();
  await stagehand.page.goto("https://www.laroche-posay.us/offers/anthelios-melt-in-milk-sunscreen-sample.html");
  await stagehand.act({ action: "close the privacy policy popup" });
  await stagehand.act({ action: "fill the last name field" });
  await stagehand.act({ action: "fill address 1 field" });
  await stagehand.act({ action: "select a state" });
  await stagehand.act({ action: "select a skin type" });
  await stagehand.context.close();
  return;
}

(async () => {
  await example();
})();

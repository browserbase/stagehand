#!/usr/bin/env -S pnpm tsx
import { Stagehand } from "../lib";
import { z } from "zod";

async function example() {
  const stagehand = new Stagehand({
    env: "LOCAL",
    verbose: 2,
    headless: false,
    debugDom: true,
  });
  
  await stagehand.init();
  await stagehand.page.goto("https://www.laroche-posay.us/offers/anthelios-melt-in-milk-sunscreen-sample.html");
  await stagehand.act({ action: "close the privacy policy popup" });
  await stagehand.act({ action: "fill the last name field" });
  await stagehand.act({ action: "fill address 1 field" });
  await stagehand.act({ action: "select a state" });
  await stagehand.act({ action: "select a skin type" });

  return;
}

(async () => {
  await example();
})();

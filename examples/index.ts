#!/usr/bin/env -S pnpm tsx
import { Stagehand } from '../lib/playwright';

async function example() {
  const stageHand = new Stagehand({ env: 'LOCAL' });
  await stageHand.init();

  await stageHand.page.goto('https://google.com');
  await stageHand.waitForSettledDom();

  await stageHand.act({
    action: 'search for "ai drones crs reports filetype:pdf"',
  });
  // await stageHand.waitForSettledDom();
  // await stageHand.act({
  //   action: 'submit the search from',
  // });
}

(async () => {
  await example();
})();

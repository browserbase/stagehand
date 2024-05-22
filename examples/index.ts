#!/usr/bin/env -S pnpm tsx
import { Stagehand } from '../lib/playwright';

async function example() {
  const stageHand = new Stagehand({ env: 'LOCAL' });
  await stageHand.init();

  await stageHand.page.goto('https://calendly.com/zerostep-test/test-calendly');
  await stageHand.waitForSettledDom();

  await stageHand.act({
    action: 'click the next available date',
  });
}

(async () => {
  await example();
})();

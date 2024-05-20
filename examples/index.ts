#!/usr/bin/env -S pnpm tsx
import { Stagehand } from '../lib/playwright';

async function example() {
  const stageHand = new Stagehand({ env: 'LOCAL' });
  await stageHand.init();

  await stageHand.page.goto('https://calendly.com/zerostep-test/test-calendly');

  const calendar = await stageHand.observe('find the calendar');
  if (!calendar) return;

  await stageHand.act({
    observation: calendar,
    action: 'click the next date on the calendar that has times available',
  });
}

(async () => {
  await example();
})();

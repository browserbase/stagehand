import { Eval } from 'braintrust';
import { Stagehand } from '../lib/playwright';

const exactMatch = (args: { input; output; expected? }) => {
  return {
    name: 'Exact match',
    score: Boolean(args.output) ? 1 : 0,
  };
};

Eval('Vanta hallucination check', {
  data: () => {
    return [
      {
        input: {
          text: 'find the buy now button',
          desired: null,
        },
      },
    ];
  },
  task: async (input) => {
    const stageHand = new Stagehand({ env: 'LOCAL', disableCache: true });
    await stageHand.init();

    await stageHand.page.goto('https://www.vanta.com/');
    await stageHand.waitForSettledDom();

    const observation = await stageHand.observe(input.text);
    console.log(observation, 'observation');

    await stageHand.browser.close();

    // we should have no saved observation since the element shouldn't exist
    return observation === null;
  },
  scores: [exactMatch],
});

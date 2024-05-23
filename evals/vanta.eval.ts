import { Eval } from 'braintrust';
import { Stagehand } from '../lib/playwright';

const exactMatch = (args: { input; output; expected? }) => {
  return {
    name: 'Exact match',
    score: Boolean(args.output) ? 1 : 0,
  };
};

Eval('Vanta', {
  data: () => {
    return [
      {
        input: {
          text: 'find the request demo button',
          desired: `body > div.page-wrapper > div.nav_component > div.nav_element.w-nav > div.padding-global > div > div > nav > div.nav_cta-wrapper.is-new > a.nav_cta-button-desktop.is-smaller.w-button`,
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

    if (!observation) return false;

    const observationResult = await stageHand.page
      .locator(stageHand.observations[observation].result)
      .first()
      .innerHTML();
    const desiredResult = await stageHand.page
      .locator(input.desired)
      .first()
      .innerHTML();

    await stageHand.browser.close();

    return observationResult == desiredResult;
  },
  scores: [exactMatch],
});

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
          text: 'add the peeler to cart',
          desired: `body > div.page-wrapper > div.nav_component > div.nav_element.w-nav > div.padding-global > div > div > nav > div.nav_cta-wrapper.is-new > a.nav_cta-button-desktop.is-smaller.w-button`,
        },
      },
    ];
  },
  task: async (input) => {
    const stageHand = new Stagehand({ env: 'LOCAL', disableCache: true });
    await stageHand.init();

    await stageHand.page.goto(
      `file://${process.cwd()}/evals/assets/peeler.html`
    );
    await stageHand.waitForSettledDom();

    await stageHand.act({ action: input.text });

    await stageHand.browser.close();

    return false;
  },
  scores: [exactMatch],
});

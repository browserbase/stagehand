import { Eval } from 'braintrust';
import { Stagehand } from '../lib/playwright';

const exactMatch = (args: { input; output; expected? }) => {
  return {
    name: 'Exact match',
    score: Boolean(args.output) ? 1 : 0,
  };
};

Eval('Peeler Simple', {
  data: () => {
    return [
      {
        input: {
          text: 'add the peeler to cart',
          desired: null,
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

    const successMessageLocator = stageHand.page.locator(
      'text="Congratulations, you have 1 A in your cart"'
    );
    await successMessageLocator.waitFor({ state: 'visible', timeout: 5000 });
    const isVisible = await successMessageLocator.isVisible();

    await stageHand.browser.close();

    return isVisible;

    return false;
  },
  scores: [exactMatch],
});

import { Eval } from 'braintrust';
import { Stagehand } from '../lib/playwright';

const vanta = async (input) => {
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

  await stageHand.context.close();

  return observationResult == desiredResult;
};

const vanta_h = async (input) => {
  const stageHand = new Stagehand({ env: 'LOCAL', disableCache: true });
  await stageHand.init();

  await stageHand.page.goto('https://www.vanta.com/');
  await stageHand.waitForSettledDom();

  const observation = await stageHand.observe(input.text);

  await stageHand.context.close();

  // we should have no saved observation since the element shouldn't exist
  return observation === null;
};

const peeler_simple = async (input) => {
  const stageHand = new Stagehand({ env: 'LOCAL', disableCache: true });
  await stageHand.init();

  await stageHand.page.goto(`file://${process.cwd()}/evals/assets/peeler.html`);
  await stageHand.waitForSettledDom();

  await stageHand.act({ action: input.text });

  const successMessageLocator = stageHand.page.locator(
    'text="Congratulations, you have 1 A in your cart"'
  );
  const isVisible = await successMessageLocator.isVisible();

  await stageHand.context.close();
  return isVisible;
};

const tasks = { vanta, vanta_h, peeler_simple };

const exactMatch = (args: { input; output; expected? }) => {
  return {
    name: 'Exact match',
    score: Boolean(args.output) ? 1 : 0,
  };
};

Eval('stagehand', {
  data: () => {
    return [
      {
        input: {
          name: 'vanta',
          text: 'find the request demo button',
          desired: `body > div.page-wrapper > div.nav_component > div.nav_element.w-nav > div.padding-global > div > div > nav > div.nav_cta-wrapper.is-new > a.nav_cta-button-desktop.is-smaller.w-button`,
        },
      },
      {
        input: {
          name: 'vanta_h',
          text: 'find the buy now button',
          desired: null,
        },
      },
      {
        input: {
          name: 'peeler_simple',
          text: 'add the peeler to cart',
          desired: null,
        },
      },
    ];
  },
  task: async (input) => {
    return await tasks[input.name](input);
  },
  scores: [exactMatch],
});

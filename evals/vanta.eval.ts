import { Eval } from "braintrust";
import { Stagehand } from "../lib/playwright";

const exactMatch = (args: { input; output; expected? }) => {
  return {
    name: "Exact match",
    score: args.output === args.expected ? 1 : 0,
  };
};


Eval("Vanta", {
  data: () => {
    return [
      {
        input: {text: "find the request demo button", desired: `body > div.page-wrapper > div.nav_component > div.nav_element.w-nav > div.padding-global > div > div > nav > div.nav_cta-wrapper.is-new > a.nav_cta-button-desktop.is-smaller.w-button`},
        expected: true,
      },
    ];
  },
  task: async (input) => {
    const stageHand = new Stagehand({ env: "LOCAL" });
    await stageHand.init();
  
    await stageHand.page.goto("https://www.vanta.com/");
  
    const observation = await stageHand.observe(input.text);
    const observationResult = await stageHand.page.locator(stageHand.observations[observation].result).first().innerHTML();
    const desiredResult = await stageHand.page.locator(input.desired).first().innerHTML();

    return observationResult == desiredResult;
  },
  scores: [exactMatch],

});
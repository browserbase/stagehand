import { Eval } from "braintrust";
import { LevenshteinScorer } from "autoevals";
import { Stagehand } from "../lib/playwright";

Eval("Github", {
  data: () => {
    return [
      {
        input: "find the python sdk",
        expected: `text=div:has-text("python-sdk")`, //Not working
      },
    ];
  },
  task: async (input) => {
    const stageHand = new Stagehand({ env: "LOCAL" });
    await stageHand.init();
  
    await stageHand.page.goto("https://github.com/orgs/browserbase/repositories");
  
    const result = await stageHand.observe(input);  
    return stageHand.observations[result].result;
  },
  scores: [LevenshteinScorer],
});
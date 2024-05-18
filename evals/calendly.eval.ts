import { Eval } from "braintrust";
import { LevenshteinScorer } from "autoevals";
import { Stagehand } from "../lib/playwright";

Eval("Calendly", {
  data: () => {
    return [
      {
        input: "find the calendar",
        expected: `div[data-testid="calendar"]`, // actually see if the underlying DOM element is good
      },
    ];
  },
  task: async (input) => {
    const stageHand = new Stagehand({ env: "LOCAL" });
    await stageHand.init();
  
    await stageHand.page.goto("https://calendly.com/zerostep-test/test-calendly");
  
    const result = await stageHand.observe(input);  
    return stageHand.observations[result].result;
  },
  scores: [LevenshteinScorer],
});
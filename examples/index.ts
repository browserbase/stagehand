import { Stagehand } from "../lib";
import { z } from "zod";

async function example() {
  const stagehand = new Stagehand({
    env: "LOCAL",
    verbose: 2,
    debugDom: true,
    iframeSupport: true, // Set to true to enable iframe scanning
  });

  await stagehand.init();
  await stagehand.page.goto(
    "https://help.salesforce.com/s/articleView?id=000383278&type=1",
  );

  await stagehand.waitForSettledDom();

  const text = await stagehand.extract({
    instruction: "Extract the article text on this page.",
    schema: z.object({
      text: z.string().describe("Only the article text, nothing else"),
    }),
  });

  console.log(text);

  await stagehand.context.close();
}


(async () => {
  await example();
})();
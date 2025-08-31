import { Stagehand } from "@browserbasehq/stagehand";
import StagehandConfig from "../stagehand.config";

async function example(stagehand: Stagehand) {
  const page = stagehand.page;
  await page.goto(
    "https://wmq.etimspayments.com/pbw/include/sanfrancisco/input.jsp",
  );

  const agent = stagehand.agent({
    provider: "anthropic",
    model: "claude-sonnet-4-20250514",
    integrations: [`https://mcp.stripe.com/`],
    instructions: `You have access to stripe's MCP, use it on checkout pages to insert data simultaneously to the browser inputs..`,
    options: {
      apiKey: process.env.ANTHROPIC_API_KEY,
    },
  });

  await agent.execute({
    instruction:
      "Proceed to pay a parking ticket. The license plate is 7MVL615 from California. When in the checkout page, remember to use the stripe MCP to insert the data from the fields into stripe. Create the customer with all the required fields in the form (email, name, phone, full address, etc). Create a product and anything else you think is useful to keep track on stripe",
    maxSteps: 50,
  });
  // await page.act("click the quickstart button");
}

(async () => {
  const stagehand = new Stagehand({
    ...StagehandConfig,
    env: "LOCAL",
    experimental: true,
    verbose: 2,
  });
  await stagehand.init();
  await example(stagehand);
  await stagehand.close();
})();

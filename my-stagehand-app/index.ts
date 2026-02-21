import "dotenv/config";
import { Stagehand } from "@browserbasehq/stagehand";
import { setupAzureOAuth } from "./azure-oauth-client";

async function main() {
  const oauth = await setupAzureOAuth();

  const stagehand = new Stagehand({
    env: "LOCAL",
    llmClient: oauth.llmClient,
  });

  await stagehand.init();

  console.log(`Stagehand Session Started`);
  console.log(
    `Watch live: https://browserbase.com/sessions/${stagehand.browserbaseSessionId}`
  );

  const page = stagehand.context.pages()[0];

  await page.goto("https://stagehand.dev");

  const extractResult = await stagehand.extract(
    "Extract the value proposition from the page."
  );
  console.log(`Extract result:\n`, extractResult);

  const actResult = await stagehand.act("Click the 'Evals' button.");
  console.log(`Act result:\n`, actResult);

  const observeResult = await stagehand.observe("What can I click on this page?");
  console.log(`Observe result:\n`, observeResult);

  const agent = stagehand.agent({
    systemPrompt: "You're a helpful assistant that can control a web browser.",
  });

  const agentResult = await agent.execute(
    "What is the most accurate model to use in Stagehand?"
  );
  console.log(`Agent result:\n`, agentResult);

  await stagehand.close();
  await oauth.cleanup();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

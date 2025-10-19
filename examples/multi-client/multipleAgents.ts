import { Stagehand } from "../../lib";

async function main() {
  console.log("Starting browser server...");
  const server = await Stagehand.launchServer({
    headless: false,
  });
  const endpoint = server.wsEndpoint();
  console.log(`Browser server started at: ${endpoint}`);

  console.log("\nStarting Agent 1 (Research task)...");
  const agent1 = new Stagehand({
    env: "BROWSERSERVER",
    wsEndpoint: endpoint,
  });
  await agent1.init();
  const page1 = await agent1.context.newPage();
  await page1.goto("https://playwright.dev");
  console.log(`Agent 1 navigated to: ${page1.url()}`);

  console.log("\nStarting Agent 2 (Form filling task)...");
  const agent2 = new Stagehand({
    env: "BROWSERSERVER",
    wsEndpoint: endpoint,
  });
  await agent2.init();
  const page2 = await agent2.context.newPage();
  await page2.goto("https://example.com");
  console.log(`Agent 2 navigated to: ${page2.url()}`);

  console.log("\nBoth agents are working in the same browser!");
  console.log("Browser contexts are isolated from each other.");

  await new Promise((resolve) => setTimeout(resolve, 5000));

  console.log("\nCleaning up...");
  await agent1.close();
  await agent2.close();
  await server.close();

  console.log("Done!");
}

main().catch(console.error);

import { Stagehand } from "../../lib";

async function main() {
  const stagehand = new Stagehand({
    env: "BROWSERSERVER",
    browserServerOptions: {
      headless: false,
    },
  });

  await stagehand.init();

  const endpoint = stagehand.wsEndpoint();
  console.log(`Browser server started!`);
  console.log(`Connect at: ${endpoint}`);

  const page = stagehand.page;
  await page.goto("https://example.com");

  console.log("Page loaded. Server will stay open for 2 minutes...");
  console.log("You can connect to it from another process using:");
  console.log(
    `\nconst stagehand = new Stagehand({ env: "BROWSERSERVER", wsEndpoint: "${endpoint}" });`,
  );

  await new Promise((resolve) => setTimeout(resolve, 120000));

  console.log("Closing browser server...");
  await stagehand.close();
}

main().catch(console.error);

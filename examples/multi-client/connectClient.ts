import { Stagehand } from "../../lib";

async function main() {
  const endpoint = process.argv[2];

  if (!endpoint) {
    console.error("Usage: ts-node connectClient.ts <ws-endpoint>");
    console.error("Example: ts-node connectClient.ts ws://localhost:9222/...");
    process.exit(1);
  }

  console.log(`Connecting to browser server at: ${endpoint}`);

  const stagehand = new Stagehand({
    env: "BROWSERSERVER",
    wsEndpoint: endpoint,
  });

  await stagehand.init();
  console.log("Connected successfully!");

  const page = await stagehand.context.newPage();
  await page.goto("https://github.com");

  console.log(`Navigated to: ${page.url()}`);

  console.log("Press Ctrl+C to disconnect...");

  process.on("SIGINT", async () => {
    console.log("\nDisconnecting...");
    await stagehand.close();
    process.exit(0);
  });

  await new Promise(() => {});
}

main().catch(console.error);

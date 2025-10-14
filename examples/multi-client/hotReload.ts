import { Stagehand } from "../../lib";

async function main() {
  const endpoint =
    process.env.BROWSER_ENDPOINT || (await startBrowserServer()).wsEndpoint();

  console.log(`Connecting to browser at: ${endpoint}`);
  console.log("(Set BROWSER_ENDPOINT env var to reuse an existing server)");

  const stagehand = new Stagehand({
    env: "BROWSERSERVER",
    wsEndpoint: endpoint,
  });

  await stagehand.init();

  const page = stagehand.page;
  const currentUrl = page.url();

  if (!currentUrl || currentUrl === "about:blank") {
    await page.goto("https://example.com");
  }

  console.log(`Current URL: ${page.url()}`);

  console.log("\nYou can now modify and restart this script.");
  console.log("The browser will stay open and retain its state.");
  console.log("Press Ctrl+C to close only this client (not the browser).");

  process.on("SIGINT", async () => {
    console.log("\nClosing client connection...");
    await stagehand.close();
    console.log("Client disconnected. Browser server is still running.");
    process.exit(0);
  });

  await new Promise(() => {});
}

async function startBrowserServer() {
  console.log("Starting new browser server...");
  const server = await Stagehand.launchServer({
    headless: false,
  });
  console.log(`Browser server started at: ${server.wsEndpoint()}`);
  console.log(`Set BROWSER_ENDPOINT=${server.wsEndpoint()} for hot reload`);
  return server;
}

main().catch(console.error);

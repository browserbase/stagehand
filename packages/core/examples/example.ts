import { Stagehand } from "../lib/v3";

const WEBMCP_CHANNEL = "mcp";

async function example(stagehand: Stagehand) {
  const page = stagehand.context.pages()[0];
  if (!page) {
    throw new Error("No page available after Stagehand init.");
  }

  // Navigate to a WebMCP-enabled page and connect.
  const webmcpPage = await stagehand.context.newPage();
  const webmcpUrl =
    process.env.WEBMCP_URL ?? "https://travel-demo.bandarra.me/";
  const webmcpClientPromise = stagehand.connectToWebMCP({
    page: webmcpPage,
    channel: WEBMCP_CHANNEL,
    waitForReady: true,
    enableModelContextShim: true,
  });

  await new Promise((resolve) => setTimeout(resolve, 4000));
  await webmcpPage.goto(webmcpUrl);
  const webmcpClient = await webmcpClientPromise;

  let nextCursor: string | undefined = undefined;
  const toolNames: string[] = [];
  do {
    const response = await webmcpClient.listTools({ cursor: nextCursor });
    toolNames.push(...response.tools.map((tool) => tool.name));
    nextCursor = response.nextCursor;
  } while (nextCursor);
  console.log("WebMCP tools:", toolNames);

  const agent = stagehand.agent({
    integrations: [webmcpClient],
  });

  const result = await agent.execute(
    "search for flights from YHZ to SFO. use the searchFLights tool",
  );
  console.log(result);
}

(async () => {
  const stagehand = new Stagehand({
    env: "LOCAL",
    verbose: 1,
    disableAPI: true,
    experimental: true,
    localBrowserLaunchOptions: {
      args: ["--enable-experimental-web-platform-features"],
    },
    disablePino: true,
  });
  await stagehand.init();
  await example(stagehand);
})();

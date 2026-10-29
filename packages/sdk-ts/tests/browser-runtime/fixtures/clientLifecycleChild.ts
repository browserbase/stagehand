import { localBrowser, Stagehand } from "../../../src/index.js";
import { claimStagehandBrowser, releaseStagehandBrowser } from "../../../src/browser/factories.js";

const browser = process.env.LIFECYCLE_CDP_URL
  ? await localBrowser.connect({ cdpUrl: process.env.LIFECYCLE_CDP_URL })
  : await localBrowser.launch({
      headless: true,
      keepAlive: process.env.LIFECYCLE_KEEP_ALIVE === "true",
      userDataDir: process.env.LIFECYCLE_PROFILE,
    });
const { cdpClient } = claimStagehandBrowser(browser);
releaseStagehandBrowser(browser);
if (process.env.LIFECYCLE_INITIALIZE !== "false") {
  const stagehand = await Stagehand.create({ browser, logging: { level: "off" } });
  await browser.context.newPage("data:text/html,<title>Stagehand reconnect witness</title>");
  if (process.env.LIFECYCLE_CLOSE_INSTANCE === "true") await stagehand.close();
}
process.send?.({ cdpUrl: cdpClient.webSocketDebuggerUrl });

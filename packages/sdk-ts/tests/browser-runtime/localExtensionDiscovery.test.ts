import { expect, it } from "vitest";
import { launchLocalBrowser } from "../../src/browser/localBrowser.js";
import { createBrowserFactoriesForTest } from "../../src/browser/factories.js";
import { CDPClient } from "../../src/cdpClient.js";
import { Stagehand } from "../../src/stagehand.js";

const extensionDir = new URL("../../../extension/dist", import.meta.url).pathname;

it.each([false, true])(
  "local connect discovers or loads Stagehand (preinstalled: %s)",
  async (preinstalled) => {
    const signal = AbortSignal.timeout(60_000);
    const chrome = await launchLocalBrowser({ headless: true }, signal);
    let attached: CDPClient | undefined;
    let stagehand: Stagehand | undefined;
    let installedId: string | undefined;
    try {
      if (preinstalled) {
        const seed = await CDPClient.connect({ cdpUrl: chrome.cdpUrl, extensionDir, signal });
        installedId = seed.serviceWorker.extensionId;
        seed.close();
      }
      const { localBrowser } = createBrowserFactoriesForTest({
        connectCdp: async (options) => {
          attached = await CDPClient.connect({ ...options, localExtensionDir: extensionDir });
          return attached;
        },
      });
      const browser = await localBrowser.connect({
        cdpUrl: chrome.cdpUrl,
        extensionId: "ignored-id",
      });
      stagehand = await Stagehand.create({ browser });
      const page = await stagehand.browser.context.newPage();
      await page.goto("data:text/html,<title>Discovered runtime</title>");
      expect(await page.title()).toBe("Discovered runtime");
      const inventory = await attached!.sendCommand<{ extensions: { id: string; name: string }[] }>(
        "Extensions.getExtensions",
        {},
        undefined,
        signal,
      );
      const installed = inventory.extensions.filter(
        (extension) => extension.name === "Stagehand Runtime",
      );
      expect(installed).toHaveLength(1);
      if (preinstalled) expect(installed[0]?.id).toBe(installedId);
      expect(attached!.serviceWorker.extensionId).toBe(installed[0]?.id);
    } finally {
      try {
        await stagehand?.close();
      } finally {
        attached?.close();
        await chrome.close();
      }
    }
  },
  60_000,
);

import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { launchLocalBrowser } from "../../src/browser/localBrowser.js";
import { createBrowserFactoriesForTest } from "../../src/browser/factories.js";
import { CDPClient } from "../../src/cdpClient.js";
import { Stagehand } from "../../src/stagehand.js";

const extensionDir = fileURLToPath(new URL("../../../extension/dist", import.meta.url));

it("keeps the content script's bindings out of the page a new tab opens on", async () => {
  const signal = AbortSignal.timeout(60_000);
  const chrome = await launchLocalBrowser({ headless: true }, signal);
  try {
    const { localBrowser } = createBrowserFactoriesForTest({
      connectCdp: async (options) =>
        await CDPClient.connect({ ...options, localExtensionDir: extensionDir }),
    });
    const browser = await localBrowser.connect({ cdpUrl: chrome.cdpUrl });
    const stagehand = await Stagehand.create({ browser, logging: { level: "off" } });

    // The extension's blank page loads the content script into the page's own world, where user
    // init scripts and page.evaluate code also run. Short names are the ones a minifier picks.
    await browser.context.addInitScript({ content: "let e = 1; const t = 2; var n = 'user';" });
    const page = await browser.context.newPage();

    await expect(page.evaluate("[e, t, n]")).resolves.toEqual([1, 2, "user"]);
    await expect(page.evaluate("let i = 0; let r = 1; i + r")).resolves.toBe(1);

    await stagehand.close();
    await browser.disconnect();
  } finally {
    await chrome.close();
  }
}, 60_000);

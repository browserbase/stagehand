import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { launchLocalBrowser } from "../../src/browser/localBrowser.js";
import { createBrowserFactoriesForTest } from "../../src/browser/factories.js";
import { CDPClient } from "../../src/cdpClient.js";
import { Stagehand } from "../../src/stagehand.js";

const extensionDir = fileURLToPath(new URL("../../../extension/dist", import.meta.url));

it("disconnect() leaves a connected Chrome running with its pages", async () => {
  const signal = AbortSignal.timeout(60_000);
  // Started outside Stagehand's browser factories, like a long-lived user browser.
  const chrome = await launchLocalBrowser({ headless: true }, signal);
  try {
    const { localBrowser } = createBrowserFactoriesForTest({
      connectCdp: async (options) =>
        await CDPClient.connect({ ...options, localExtensionDir: extensionDir }),
    });
    const browser = await localBrowser.connect({ cdpUrl: chrome.cdpUrl });
    const stagehand = await Stagehand.create({ browser, logging: { level: "off" } });
    const page = await browser.context.newPage();
    await page.goto("data:text/html,<title>still here</title>", { waitUntil: "load" });
    await stagehand.close();

    await browser.disconnect();
    expect(browser.closed).toBe(true);
    await browser.close();

    const endpoint = new URL(chrome.cdpUrl);
    const version = await fetch(`http://${endpoint.host}/json/version`);
    expect(version.ok).toBe(true);
    const targets = (await (await fetch(`http://${endpoint.host}/json/list`)).json()) as Array<{
      title: string;
    }>;
    expect(targets.map((target) => target.title)).toContain("still here");
  } finally {
    await chrome.close();
  }
});

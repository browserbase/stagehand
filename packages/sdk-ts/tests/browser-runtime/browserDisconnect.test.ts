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
    await expect(browser.close()).rejects.toThrow("connect() again to close it");

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
}, 60_000);

it("disconnect() closes the attached Stagehand so a new connection can create one", async () => {
  const signal = AbortSignal.timeout(60_000);
  const chrome = await launchLocalBrowser({ headless: true }, signal);
  try {
    const { localBrowser } = createBrowserFactoriesForTest({
      connectCdp: async (options) =>
        await CDPClient.connect({ ...options, localExtensionDir: extensionDir }),
    });
    const browser = await localBrowser.connect({ cdpUrl: chrome.cdpUrl });
    const stagehand = await Stagehand.create({ browser, logging: { level: "off" } });

    // No stagehand.close(): disconnect() must close the instance and the worker's loopback.
    await browser.disconnect();
    expect(stagehand.initialized).toBe(false);
    await stagehand.close();

    const browser2 = await localBrowser.connect({ cdpUrl: chrome.cdpUrl });
    const stagehand2 = await Stagehand.create({ browser: browser2, logging: { level: "off" } });
    const page = await browser2.context.newPage();
    await page.goto("data:text/html,<title>reattached</title>", { waitUntil: "load" });
    expect(await page.title()).toBe("reattached");
    await stagehand2.close();
    await browser2.disconnect();
  } finally {
    await chrome.close();
  }
}, 60_000);

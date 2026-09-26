import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Page, Stagehand } from "../../src/index.js";
import {
  closeStagehand,
  createStagehand,
  firstPage,
  startFixtureServer,
  type FixtureServer,
} from "./_support.js";

async function imageLoads(page: Page, url: string): Promise<boolean> {
  await page.goto(`data:text/html,${encodeURIComponent(`<img id="probe" src="${url}">`)}`);
  return page.evaluate(async () => {
    const image = document.querySelector<HTMLImageElement>("#probe")!;
    if (image.complete) return image.naturalWidth > 0;
    return new Promise<boolean>((resolve) => {
      image.addEventListener("load", () => resolve(true), { once: true });
      image.addEventListener("error", () => resolve(false), { once: true });
    });
  });
}

describe("context.setDomainPolicy", () => {
  let fixture: FixtureServer;
  let stagehand: Stagehand;
  let allowedUrl: string;
  let alternateHostUrl: string;
  let metadataHostUrl: string;

  beforeEach(async () => {
    fixture = await startFixtureServer({
      "/pixel.svg": {
        headers: { "content-type": "image/svg+xml" },
        body: `<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1"/></svg>`,
      },
      "/popup": `<h1>popup</h1>`,
    });
    allowedUrl = new URL("/pixel.svg", fixture.url).href;
    alternateHostUrl = allowedUrl.replace("127.0.0.1", "alternate.test");
    metadataHostUrl = allowedUrl.replace("127.0.0.1", "metadata.google.internal");
    stagehand = await createStagehand({
      browser: {
        args: [
          "--host-resolver-rules=MAP alternate.test 127.0.0.1,MAP metadata.google.internal 127.0.0.1",
        ],
      },
    });
  });

  afterEach(async () => {
    await closeStagehand(stagehand);
    await fixture.close();
  });

  it("blocks matching requests on existing pages", async () => {
    const page = await firstPage(stagehand);
    await stagehand.browser.context.setDomainPolicy({ blockedDomains: ["127.0.0.1"] });

    await expect(imageLoads(page, allowedUrl)).resolves.toBe(false);
  });

  it("applies to pages created after setting the policy", async () => {
    await stagehand.browser.context.setDomainPolicy({ blockedDomains: ["127.0.0.1"] });
    const page = await stagehand.browser.context.newPage();

    await expect(imageLoads(page, allowedUrl)).resolves.toBe(false);
  });

  it("allows matching requests and blocks non-matching requests", async () => {
    const page = await firstPage(stagehand);
    // Prove the alternate hostname reaches this fixture before policy is applied,
    // so the later chrome-error can only be attributed to domain policy.
    const initialResponse = await page.goto(alternateHostUrl);
    expect(initialResponse?.ok()).toBe(true);
    await stagehand.browser.context.setDomainPolicy({ allowedDomains: ["127.0.0.1"] });

    const allowedResponse = await page.goto(allowedUrl);
    expect(allowedResponse?.ok()).toBe(true);
    const blockedPage = await stagehand.browser.context.newPage();
    await blockedPage.goto(alternateHostUrl);
    await expect(blockedPage.url()).resolves.toMatch(/^chrome-error:/);
  });

  it("blocked domains take precedence over allowed domains", async () => {
    const page = await firstPage(stagehand);
    await stagehand.browser.context.setDomainPolicy({
      allowedDomains: ["127.0.0.1"],
      blockedDomains: ["127.0.0.1"],
    });

    await expect(imageLoads(page, allowedUrl)).resolves.toBe(false);
  });

  it("allowed domains apply to pages created afterward", async () => {
    await stagehand.browser.context.setDomainPolicy({ allowedDomains: ["127.0.0.1"] });
    const page = await stagehand.browser.context.newPage();

    const response = await page.goto(allowedUrl);
    expect(response?.ok()).toBe(true);
  });

  it("does not retain a popup targeting a blocked domain", async () => {
    const page = await firstPage(stagehand);
    const popupUrl = new URL("/popup", fixture.url).href;
    await stagehand.browser.context.setDomainPolicy({ blockedDomains: ["127.0.0.1"] });
    await page.goto(
      `data:text/html,${encodeURIComponent(`<button id="open" onclick="window.__blockedPopup = window.open('${popupUrl}')">open</button>`)}`,
    );
    const knownPageIds = new Set(
      (await stagehand.browser.context.pages()).map((candidate) => candidate.pageId),
    );
    await page.locator("#open").click();

    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              (window as typeof window & { __blockedPopup?: Window }).__blockedPopup?.closed ??
              false,
          ),
        { timeout: 5_000, interval: 50 },
      )
      .toBe(true);
    await expect
      .poll(
        async () =>
          (await stagehand.browser.context.pages()).every((candidate) =>
            knownPageIds.has(candidate.pageId),
          ),
        { timeout: 5_000, interval: 50 },
      )
      .toBe(true);
  });

  it("blocks a metadata hostname by default while the loopback fixture still loads", async () => {
    const page = await firstPage(stagehand);
    const loopbackResponse = await page.goto(allowedUrl);
    expect(loopbackResponse?.ok()).toBe(true);

    await page.goto(metadataHostUrl);

    await expect(page.url()).resolves.toMatch(/^chrome-error:/);
  });

  it("allows a metadata hostname named in allowedDomains", async () => {
    const page = await firstPage(stagehand);
    await stagehand.browser.context.setDomainPolicy({
      allowedDomains: ["127.0.0.1", "metadata.google.internal"],
    });

    const response = await page.goto(metadataHostUrl);
    expect(response?.ok()).toBe(true);
  });

  it("returns to the default posture when the policy is cleared", async () => {
    const page = await firstPage(stagehand);
    await stagehand.browser.context.setDomainPolicy({
      allowedDomains: ["127.0.0.1", "metadata.google.internal"],
    });
    const allowedResponse = await page.goto(metadataHostUrl);
    expect(allowedResponse?.ok()).toBe(true);

    await stagehand.browser.context.setDomainPolicy(null);
    await page.goto(metadataHostUrl);

    await expect(page.url()).resolves.toMatch(/^chrome-error:/);
  });

  it("replaces the default posture with an explicit blocklist", async () => {
    const page = await firstPage(stagehand);
    await stagehand.browser.context.setDomainPolicy({ blockedDomains: ["example.com"] });

    const response = await page.goto(metadataHostUrl);
    expect(response?.ok()).toBe(true);
  });

  it("does not retain a popup targeting a default-blocked host", async () => {
    const page = await firstPage(stagehand);
    const popupUrl = new URL("/popup", fixture.url).href.replace(
      "127.0.0.1",
      "metadata.google.internal",
    );
    await page.goto(
      `data:text/html,${encodeURIComponent(`<button id="open" onclick="window.__defaultBlockedPopup = window.open('${popupUrl}')">open</button>`)}`,
    );
    const knownPageIds = new Set(
      (await stagehand.browser.context.pages()).map((candidate) => candidate.pageId),
    );
    await page.locator("#open").click();

    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              (window as typeof window & { __defaultBlockedPopup?: Window }).__defaultBlockedPopup
                ?.closed ?? false,
          ),
        { timeout: 5_000, interval: 50 },
      )
      .toBe(true);
    await expect
      .poll(
        async () =>
          (await stagehand.browser.context.pages()).every((candidate) =>
            knownPageIds.has(candidate.pageId),
          ),
        { timeout: 5_000, interval: 50 },
      )
      .toBe(true);
  });
});

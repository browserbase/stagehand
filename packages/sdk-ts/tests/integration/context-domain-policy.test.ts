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
    stagehand = await createStagehand({
      browser: {
        args: ["--host-resolver-rules=MAP alternate.test 127.0.0.1"],
      },
    });
  });

  afterEach(async () => {
    await closeStagehand(stagehand);
    await fixture.close();
  });

  it("blocks matching requests on existing pages", async () => {
    const page = await firstPage(stagehand);
    await stagehand.context.setDomainPolicy({ blockedDomains: ["127.0.0.1"] });

    await expect(imageLoads(page, allowedUrl)).resolves.toBe(false);
  });

  it("applies to pages created after setting the policy", async () => {
    await stagehand.context.setDomainPolicy({ blockedDomains: ["127.0.0.1"] });
    const page = await stagehand.context.newPage();

    await expect(imageLoads(page, allowedUrl)).resolves.toBe(false);
  });

  it("allows matching requests and blocks non-matching requests", async () => {
    const page = await firstPage(stagehand);
    // Prove the alternate hostname reaches this fixture before policy is applied,
    // so the later chrome-error can only be attributed to domain policy.
    await expect(page.goto(alternateHostUrl)).resolves.toBe(page);
    await stagehand.context.setDomainPolicy({ allowedDomains: ["127.0.0.1"] });

    await expect(page.goto(allowedUrl)).resolves.toBe(page);
    const blockedPage = await stagehand.context.newPage();
    await blockedPage.goto(alternateHostUrl);
    await expect(blockedPage.url()).resolves.toMatch(/^chrome-error:/);
  });

  it("blocked domains take precedence over allowed domains", async () => {
    const page = await firstPage(stagehand);
    await stagehand.context.setDomainPolicy({
      allowedDomains: ["127.0.0.1"],
      blockedDomains: ["127.0.0.1"],
    });

    await expect(imageLoads(page, allowedUrl)).resolves.toBe(false);
  });

  it("allowed domains apply to pages created afterward", async () => {
    await stagehand.context.setDomainPolicy({ allowedDomains: ["127.0.0.1"] });
    const page = await stagehand.context.newPage();

    await expect(page.goto(allowedUrl)).resolves.toBe(page);
  });

  it("does not retain a popup targeting a blocked domain", async () => {
    const page = await firstPage(stagehand);
    const popupUrl = new URL("/popup", fixture.url).href;
    await stagehand.context.setDomainPolicy({ blockedDomains: ["127.0.0.1"] });
    await page.goto(
      `data:text/html,${encodeURIComponent(`<button id="open" onclick="window.__blockedPopup = window.open('${popupUrl}')">open</button>`)}`,
    );
    const knownPageIds = new Set(
      (await stagehand.context.pages()).map((candidate) => candidate.pageId),
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
          (await stagehand.context.pages()).every((candidate) =>
            knownPageIds.has(candidate.pageId),
          ),
        { timeout: 5_000, interval: 50 },
      )
      .toBe(true);
  });
});

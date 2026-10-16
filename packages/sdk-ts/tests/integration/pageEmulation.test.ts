import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Page, Stagehand } from "../../src/index.js";
import {
  closeStagehand,
  createStagehand,
  firstPage,
  startFixtureServer,
  type FixtureServer,
} from "./_support.js";

describe("page emulation", () => {
  let fixture: FixtureServer;
  let stagehand: Stagehand;

  beforeEach(async () => {
    fixture = await startFixtureServer((request) => ({
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request.headers),
    }));
    stagehand = await createStagehand();
  });

  afterEach(async () => {
    await closeStagehand(stagehand);
    await fixture.close();
  });

  const matchesMedia = (page: Page, query: string) =>
    page.evaluate((media: string) => matchMedia(media).matches, query);

  it("emulates media features across navigations and clears them with no-override", async () => {
    const page = await firstPage(stagehand);
    await page.goto(fixture.url);
    // Chrome follows the host appearance, so emulate the opposite of its default.
    const defaultIsDark = await matchesMedia(page, "(prefers-color-scheme: dark)");
    const colorScheme = defaultIsDark ? "light" : "dark";

    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    await page.goto(fixture.url);

    expect(await matchesMedia(page, `(prefers-color-scheme: ${colorScheme})`)).toBe(true);
    expect(await matchesMedia(page, "(prefers-reduced-motion: reduce)")).toBe(true);

    await page.emulateMedia({ colorScheme: "no-override" });

    expect(await matchesMedia(page, "(prefers-color-scheme: dark)")).toBe(defaultIsDark);
    expect(await matchesMedia(page, "(prefers-reduced-motion: reduce)")).toBe(true);
  });

  it("overrides the user agent across navigations and restores the default", async () => {
    const page = await firstPage(stagehand);
    await page.goto(fixture.url);
    const defaultUserAgent = await page.evaluate(() => navigator.userAgent);

    await page.setUserAgent("StagehandTest/1.0");
    await page.goto(fixture.url);

    expect(await page.evaluate(() => navigator.userAgent)).toBe("StagehandTest/1.0");
    const headers = await page.evaluate<Record<string, string>>(() =>
      JSON.parse(document.body.innerText),
    );
    expect(headers["user-agent"]).toBe("StagehandTest/1.0");

    await page.setUserAgent("");
    await page.goto(fixture.url);

    expect(await page.evaluate(() => navigator.userAgent)).toBe(defaultUserAgent);
  });
});

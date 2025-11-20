import { expect, test } from "@playwright/test";
import { V3 } from "../v3";
import { v3DynamicTestConfig } from "./v3.dynamic.config";
import { resolveXpathForLocation } from "../understudy/a11y/snapshot";

test.describe("resolveNodeForLocationDeep", () => {
  let v3: V3;

  test.beforeEach(async () => {
    v3 = new V3(v3DynamicTestConfig);
    await v3.init();
  });

  test.afterEach(async () => {
    await v3?.close?.().catch(() => {});
  });

  test("click resolves inside same-process iframe and returns absolute XPath", async () => {
    const page = await v3.context.awaitActivePage();

    // Set consistent viewport size to ensure stable rendering across environments
    await page.setViewportSize(1280, 720);

    await page.goto(
      "https://browserbase.github.io/stagehand-eval-sites/sites/iframe-hn/",
      { waitUntil: "networkidle" },
    );

    // scroll to the bottom of the page
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
    });

    // scroll to the bottom of the iframe
    const frame = page.frames()[0];
    await frame.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
    });

    // Wait a bit for the iframe content to settle after scrolling
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Get the iframe's position in the main page
    const iframeOffset = await page.evaluate(() => {
      const iframe = document.querySelector("section iframe");
      if (!iframe) return null;
      const rect = iframe.getBoundingClientRect();
      return {
        left: rect.left,
        top: rect.top,
      };
    });

    // Get the link's position within the iframe
    const linkOffsetInFrame = await frame.evaluate(() => {
      // Find the 88th row, 3rd column link (the one we're testing)
      const table = document.querySelector(
        "center > table > tbody > tr:nth-child(3) > td > table",
      );
      if (!table) return null;

      const row88 = table.querySelector("tbody > tr:nth-child(88)");
      if (!row88) return null;

      const cell3 = row88.querySelector("td:nth-child(3)");
      if (!cell3) return null;

      const link = cell3.querySelector("span > a");
      if (!link) return null;

      const rect = link.getBoundingClientRect();
      // Return center coordinates of the link relative to iframe
      return {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      };
    });

    // Combine iframe offset and link offset to get page-level coordinates
    // Fallback to hardcoded coordinates if element not found (shouldn't happen)
    const x =
      iframeOffset && linkOffsetInFrame
        ? iframeOffset.left + linkOffsetInFrame.x
        : 356;
    const y =
      iframeOffset && linkOffsetInFrame
        ? iframeOffset.top + linkOffsetInFrame.y
        : 503;

    const result = await resolveXpathForLocation(page, x, y);
    console.log("=== Coordinates used:", { x, y });
    console.log("=== Result:", result);
    const xpath = result.absoluteXPath;
    expect(xpath).toBe(
      "/html[1]/body[1]/main[1]/section[3]/iframe[1]/html[1]/body[1]/center[1]/table[1]/tbody[1]/tr[3]/td[1]/table[1]/tbody[1]/tr[88]/td[3]/span[1]/a[1]",
    );
  });
});

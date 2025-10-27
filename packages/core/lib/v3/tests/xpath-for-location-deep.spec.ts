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
    await page.goto(
      "https://browserbase.github.io/stagehand-eval-sites/sites/iframe-hn/",
    );
    await new Promise((resolve) => setTimeout(resolve, 1000));
    // scroll to the bottom of the page
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
    });
    // scroll to the bottom of the iframe
    const frame = page.frames()[0];
    await frame.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
    });
    const result = await resolveXpathForLocation(page, 356, 503);
    console.log(result);
    const xpath = result.absoluteXPath;
    expect(xpath).toBe(
      "/html[1]/body[1]/main[1]/section[3]/iframe[1]/html[1]/body[1]/center[1]/table[1]/tbody[1]/tr[3]/td[1]/table[1]/tbody[1]/tr[88]/td[3]/span[1]/a[1]",
    );
  });
});

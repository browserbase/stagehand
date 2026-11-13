import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Stagehand } from "../../src/index.js";
import {
  closeStagehand,
  createStagehand,
  firstPage,
  startFixtureServer,
  type FixtureServer,
} from "./_support.js";

// A shadow root anywhere in the document routes XPath through the composed-tree parser
// instead of document.evaluate(), and that parser is only reachable over http: data: URLs
// keep the native engine, so these cases have to be served to exercise it at all.
const FIXTURE = `<!doctype html>
<html>
  <body>
    <section>
      <div class="rel">one</div>
      <div class="rel">two</div>
    </section>
    <div id="widget"></div>
    <script>
      document.getElementById("widget").attachShadow({ mode: "open" }).innerHTML =
        "<span>unrelated widget</span>";
    </script>
  </body>
</html>`;

describe("XPath self steps with a shadow root in the document", () => {
  let fixtureServer: FixtureServer;
  let stagehand: Stagehand;

  beforeAll(async () => {
    fixtureServer = await startFixtureServer(FIXTURE);
    stagehand = await createStagehand();
  });

  afterAll(async () => {
    await closeStagehand(stagehand);
    await fixtureServer.close();
  });

  it("resolves a relative .// path from the document", async () => {
    const page = await firstPage(stagehand);
    await page.goto(fixtureServer.url, { waitUntil: "load" });

    // Locators always evaluate against the document, so `.//div` means `//div` here,
    // as it does for document.evaluate().
    await expect.poll(() => page.locator("xpath=.//div[@class='rel']").count()).toBe(2);
    await expect(page.locator("xpath=.//div[@class='rel']").first().innerText()).resolves.toBe(
      "one",
    );
  });

  it("skips a . step in the middle of a path", async () => {
    const page = await firstPage(stagehand);
    await page.goto(fixtureServer.url, { waitUntil: "load" });

    await expect.poll(() => page.locator("xpath=//section/./div").count()).toBe(2);
    await expect(page.locator("xpath=//section/.//div[@class='rel']").count()).resolves.toBe(2);
  });
});

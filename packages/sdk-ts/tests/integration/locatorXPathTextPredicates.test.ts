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
    <button id="wrapped"><span>Save</span></button>
    <button id="direct">Save</button>
    <div id="mixed">a<span>b</span></div>
    <div id="split">x<br />y</div>
    <div id="widget"></div>
    <script>
      document.getElementById("widget").attachShadow({ mode: "open" }).innerHTML =
        "<span>unrelated widget</span>";
    </script>
  </body>
</html>`;

describe("XPath text() predicates with a shadow root in the document", () => {
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

  it("reads text() from direct child text nodes only", async () => {
    const page = await firstPage(stagehand);
    await page.goto(fixtureServer.url, { waitUntil: "load" });

    // #wrapped holds its label in a <span>, so it has no direct text child to match.
    await expect.poll(() => page.locator("xpath=//button[text()='Save']").count()).toBe(1);
    await expect(page.locator("xpath=//button[text()='Save']").innerHtml()).resolves.toBe("Save");

    // `.` is the string-value of the element, so it still sees the whole subtree.
    await expect(page.locator("xpath=//button[.='Save']").count()).resolves.toBe(2);

    await expect(page.locator("xpath=//div[text()='a']").count()).resolves.toBe(1);
    await expect(page.locator("xpath=//div[contains(text(),'b')]").count()).resolves.toBe(0);
  });

  it("compares a node-set existentially and collapses it inside functions", async () => {
    const page = await firstPage(stagehand);
    await page.goto(fixtureServer.url, { waitUntil: "load" });

    // #split has two text nodes, `x` and `y`: `=` holds when either one matches.
    await expect.poll(() => page.locator("xpath=//div[@id='split'][text()='y']").count()).toBe(1);

    // contains() and normalize-space() take a string, so the node-set collapses to `x`.
    await expect(
      page.locator("xpath=//div[@id='split'][contains(text(),'y')]").count(),
    ).resolves.toBe(0);
    await expect(
      page.locator("xpath=//div[@id='split'][normalize-space(text())='x']").count(),
    ).resolves.toBe(1);
  });
});

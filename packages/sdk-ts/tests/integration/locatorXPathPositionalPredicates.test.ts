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
    <section id="s1">
      <div>A1</div>
      <div>A2</div>
      <div class="x">A3</div>
    </section>
    <section id="s2">
      <div class="x"><div>C1</div><div>C2</div></div>
      <div class="x">B2</div>
    </section>
    <p id="widget"></p>
    <script>
      document.getElementById("widget").attachShadow({ mode: "open" }).innerHTML =
        "<em>W1</em><em>W2</em>";
    </script>
  </body>
</html>`;

describe("XPath positional predicates with a shadow root in the document", () => {
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

  it("counts [n] among the siblings of each parent", async () => {
    const page = await firstPage(stagehand);
    await page.goto(fixtureServer.url, { waitUntil: "load" });

    // Every div that is the second div child of its parent, not the second div on the page.
    const second = page.locator("xpath=//div[2]");
    await expect.poll(() => second.count()).toBe(3);
    await expect(second.nth(0).innerHtml()).resolves.toBe("A2");
    await expect(second.nth(1).innerHtml()).resolves.toBe("C2");
    await expect(second.nth(2).innerHtml()).resolves.toBe("B2");

    await expect(page.locator("xpath=//section//div[2]").count()).resolves.toBe(3);
    await expect(page.locator("xpath=//section[@id='s1']/div[2]").innerHtml()).resolves.toBe("A2");
  });

  it("counts [n] after the predicates that precede it", async () => {
    const page = await firstPage(stagehand);
    await page.goto(fixtureServer.url, { waitUntil: "load" });

    // #s1 has one .x child, so the only second .x child on the page is in #s2.
    const secondX = page.locator("xpath=//div[@class='x'][2]");
    await expect.poll(() => secondX.count()).toBe(1);
    await expect(secondX.innerHtml()).resolves.toBe("B2");
  });

  it("matches nothing at position zero", async () => {
    const page = await firstPage(stagehand);
    await page.goto(fixtureServer.url, { waitUntil: "load" });

    await expect.poll(() => page.locator("xpath=//div[1]").count()).toBe(3);
    await expect(page.locator("xpath=//div[0]").count()).resolves.toBe(0);
    await expect(page.locator("xpath=//section[@id='s1']/div[0]").count()).resolves.toBe(0);
  });

  it("still counts inside the shadow root", async () => {
    const page = await firstPage(stagehand);
    await page.goto(fixtureServer.url, { waitUntil: "load" });

    await expect.poll(() => page.locator("xpath=//em[2]").count()).toBe(1);
    await expect(page.locator("xpath=//em[2]").innerHtml()).resolves.toBe("W2");
  });
});

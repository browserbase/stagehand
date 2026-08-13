import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Stagehand } from "../../src/index.js";
import {
  closeStagehand,
  createStagehand,
  firstPage,
  startFixtureServer,
  type FixtureServer,
} from "./_support.js";

describe("Locator count() method tests", () => {
  let stagehand: Stagehand;
  let fixtureServer: FixtureServer | undefined;

  beforeEach(async () => {
    stagehand = await createStagehand();
  });

  afterEach(async () => {
    await Promise.all([closeStagehand(stagehand), fixtureServer?.close()]);
    fixtureServer = undefined;
  });

  it("count() returns correct number for CSS selectors", async () => {
    const page = await firstPage(stagehand);

    await page.goto(
      "data:text/html,<div class='test'>1</div><div class='test'>2</div><div class='test'>3</div><span>4</span>",
    );

    const locator = page.locator(".test");
    const count = await locator.count();

    expect(count).toBe(3);
  });

  it("count() returns 0 for non-matching selectors", async () => {
    const page = await firstPage(stagehand);

    await page.goto("data:text/html,<div>Test</div>");

    const locator = page.locator(".non-existent");
    const count = await locator.count();

    expect(count).toBe(0);
  });

  it("count() works with XPath selectors", async () => {
    const page = await firstPage(stagehand);

    await page.goto(
      "data:text/html,<button>Button 1</button><button>Button 2</button><button>Button 3</button>",
    );

    const locator = page.locator("//button");
    const count = await locator.count();

    expect(count).toBe(3);
  });

  it("preserves native XPath predicates when an unrelated shadow root exists", async () => {
    const page = await firstPage(stagehand);
    fixtureServer = await startFixtureServer(
      '<section><div class="row">A1</div><div class="row">A2</div></section>' +
        '<section><div class="row">B1</div><div class="row">B2</div></section>' +
        '<div id="widget"></div>' +
        "<script>document.getElementById('widget').attachShadow({mode: 'open'})</script>",
    );
    await page.goto(fixtureServer.url);

    await expect(page.locator("xpath=//div[2]").count()).resolves.toBe(2);
    await expect(page.locator("xpath=//div[0]").count()).resolves.toBe(0);
    await expect(page.locator("xpath=(//div)[2]").count()).resolves.toBe(1);
    await expect(page.locator("xpath=//div[position() > 1]").count()).rejects.toThrow(
      "Unsupported XPath predicate in composed-tree traversal: position() > 1",
    );
  });

  it("keeps both light and shadow DOM matches for supported XPath", async () => {
    const page = await firstPage(stagehand);
    fixtureServer = await startFixtureServer(
      '<button id="light">light</button><div id="host"></div>' +
        "<script>document.getElementById('host').attachShadow({mode: 'open'}).innerHTML=" +
        "'<button id=\"shadow\">shadow</button>'</script>",
    );
    await page.goto(fixtureServer.url);

    await expect(page.locator("xpath=//button").count()).resolves.toBe(2);
    await expect(page.locator("xpath=//button").first().textContent()).resolves.toBe("light");
  });

  it("count() works with text selectors", async () => {
    const page = await firstPage(stagehand);

    await page.goto(
      "data:text/html,<div>Click me</div><button>Click me</button><span>Don't click me</span>",
    );

    const locator = page.locator("text=Click me");
    const count = await locator.count();

    // Case-insensitive substring match: also matches "Don't click me"
    expect(count).toBe(3);
  });

  it("count() handles shadow DOM elements", async () => {
    const page = await firstPage(stagehand);

    await page.goto(
      "data:text/html," +
        encodeURIComponent(
          '<div id="host"></div>' +
            "<script>" +
            'const host = document.getElementById("host");' +
            'const shadow = host.attachShadow({mode: "open"});' +
            'shadow.innerHTML = "<button>1</button><button>2</button>";' +
            "</script>",
        ),
      { waitUntil: "load", timeout: 30000 },
    );

    const locator = page.locator("button");
    await expect.poll(() => locator.count()).toBe(2);
  });

  it("count() works with complex CSS selectors", async () => {
    const page = await firstPage(stagehand);

    await page.goto(
      "data:text/html,<div class='container'><span class='item'>1</span><span class='item'>2</span></div><div><span class='item'>3</span></div>",
    );

    const locator = page.locator(".container .item");
    const count = await locator.count();

    expect(count).toBe(2);
  });
});

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Stagehand } from "../../src/index.js";
import { closeStagehand, createStagehand, firstPage } from "./_support.js";

describe("Locator count() method tests", () => {
  let stagehand: Stagehand;

  beforeEach(async () => {
    stagehand = await createStagehand();
  });

  afterEach(async () => {
    await closeStagehand(stagehand);
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

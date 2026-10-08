import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Stagehand } from "../../src/index.js";
import { closeStagehand, createStagehand, firstPage, startFixtureServer } from "./_support.js";

describe("text selector innermost element matching", () => {
  let stagehand: Stagehand;

  beforeEach(async () => {
    stagehand = await createStagehand();
  });

  afterEach(async () => {
    await closeStagehand(stagehand);
  });

  it("matches only the innermost element", async () => {
    const page = await firstPage(stagehand);
    await page.goto(
      `data:text/html,${encodeURIComponent(`<div id="outer"><span id="middle"><button id="inner" onclick="document.body.dataset.clicked=this.id">Click me</button></span></div>`)}`,
    );

    const locator = page.locator("text=Click me");
    expect(await locator.count()).toBe(1);
    await locator.click();
    expect(await page.evaluate(() => document.body.dataset.clicked)).toBe("inner");
  });

  it("matches multiple innermost elements with the same text", async () => {
    const page = await firstPage(stagehand);
    await page.goto(
      `data:text/html,${encodeURIComponent(`<div><button>Submit</button><span>Other</span><button>Submit</button></div><div><a href="#">Submit</a></div>`)}`,
    );

    expect(await page.locator("text=Submit").count()).toBe(3);
  });

  it("selects the narrowest element containing the requested text", async () => {
    const page = await firstPage(stagehand);
    await page.goto(
      `data:text/html,${encodeURIComponent(`<div id="parent">Hello <span id="child">World</span></div>`)}`,
    );

    expect(await page.locator("text=Hello").count()).toBe(1);
    expect(await page.locator("text=World").count()).toBe(1);
    expect(await page.locator("text=Hello World").count()).toBe(1);
  });

  it("counts a large repeated list and resolves its last match across a closed shadow root", async () => {
    const page = await firstPage(stagehand);
    const fixture = await startFixtureServer("<div id='root'></div>");
    try {
      await page.goto(fixture.url);
      await page.evaluate(() => {
        document.getElementById("root")!.innerHTML = Array.from(
          { length: 10_000 },
          (_, i) => `<div><button>Repeated label ${i}</button></div>`,
        ).join("");
        const host = document.createElement("section");
        host.attachShadow({ mode: "closed" }).innerHTML = "<button>Repeated label shadow</button>";
        document.body.appendChild(host);
      });

      const locator = page.locator("text=Repeated label");
      expect(await locator.count()).toBe(10_001);
      expect(await locator.nth(9_999).innerText()).toBe("Repeated label 9999");
      expect(await locator.nth(10_000).innerText()).toBe("Repeated label shadow");
    } finally {
      await fixture.close();
    }
  });
});

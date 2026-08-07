import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Stagehand } from "../../src/index.js";
import { closeStagehand, createStagehand, firstPage } from "./_support.js";

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
});

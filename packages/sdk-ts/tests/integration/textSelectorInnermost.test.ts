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

  it("does not treat block text separated by a newline as one word", async () => {
    const page = await firstPage(stagehand);
    await page.goto(
      `data:text/html,${encodeURIComponent(`<div><div>Hello</div><div>World</div></div>`)}`,
    );

    expect(await page.locator("text=HelloWorld").count()).toBe(0);
    const matches = page.locator("text=Hello");
    expect(await matches.count()).toBe(1);
    expect(await matches.innerText()).toBe("Hello");
  });

  it("collapses whitespace in a leaf element like innerText", async () => {
    const page = await firstPage(stagehand);
    await page.goto(`data:text/html,${encodeURIComponent(`<button>Hello   \n   World</button>`)}`);

    expect(await page.locator("text=Hello World").count()).toBe(1);
  });

  it("matches hidden text through the textContent fallback", async () => {
    const page = await firstPage(stagehand);
    await page.goto(
      `data:text/html,${encodeURIComponent(`<div style="display:none">Hidden label</div><span>Hidden label</span>`)}`,
    );

    expect(await page.locator("text=Hidden label").count()).toBe(2);
  });

  it("orders a light-DOM match before an open shadow match", async () => {
    const page = await firstPage(stagehand);
    await page.goto(`data:text/html,${encodeURIComponent("<main id='root'></main>")}`);
    await page.evaluate(() => {
      const host = document.createElement("div");
      const light = document.createElement("button");
      light.textContent = "Light label";
      host.appendChild(light);
      document.querySelector("#root")!.appendChild(host);
      host.attachShadow({ mode: "open" }).innerHTML = "<button>Shadow label</button>";
    });

    const matches = page.locator("text=label");
    expect(await matches.count()).toBe(2);
    expect(await matches.nth(0).innerText()).toBe("Light label");
    expect(await matches.nth(1).innerText()).toBe("Shadow label");
  });

  it("keeps a shadow host when its shadow tree also matches", async () => {
    const page = await firstPage(stagehand);
    await page.goto(`data:text/html,${encodeURIComponent("<main id='root'></main>")}`);
    await page.evaluate(() => {
      const host = document.createElement("div");
      host.textContent = "Host label outside";
      host.addEventListener("click", () => {
        document.body.dataset.clicked = "host";
      });
      document.querySelector("#root")!.appendChild(host);
      const shadow = host.attachShadow({ mode: "open" });
      const inner = document.createElement("span");
      inner.textContent = "Host label inside";
      inner.addEventListener("click", (event) => {
        event.stopPropagation();
        document.body.dataset.clicked = "shadow";
      });
      shadow.appendChild(inner);
    });

    const matches = page.locator("text=Host label");
    expect(await matches.count()).toBe(2);
    await matches.nth(0).click();
    expect(await page.evaluate(() => document.body.dataset.clicked)).toBe("host");
    await matches.nth(1).click();
    expect(await page.evaluate(() => document.body.dataset.clicked)).toBe("shadow");
  });

  it("searches sibling shadow roots before a shadow root nested in an earlier host", async () => {
    const fixture = await startFixtureServer({
      "/": "<!doctype html><main id='root'></main>",
    });
    try {
      const page = await firstPage(stagehand);
      await page.goto(fixture.url, { waitUntil: "load" });
      await page.evaluate(() => {
        const root = document.querySelector("#root")!;
        root.innerHTML = `<span>Label light</span><div id="hostA"></div><div id="hostC"></div>`;
        const shadowA = document.querySelector("#hostA")!.attachShadow({ mode: "closed" });
        shadowA.innerHTML = `<b>Label A</b><div id="hostB"></div>`;
        shadowA
          .querySelector("#hostB")!
          .attachShadow({ mode: "closed" }).innerHTML = `<i>Label B</i>`;
        document
          .querySelector("#hostC")!
          .attachShadow({ mode: "closed" }).innerHTML = `<em>Label C</em>`;
      });

      const matches = page.locator("text=Label");
      expect(await matches.count()).toBe(4);
      expect(await matches.nth(0).innerText()).toBe("Label light");
      expect(await matches.nth(1).innerText()).toBe("Label A");
      expect(await matches.nth(2).innerText()).toBe("Label C");
      expect(await matches.nth(3).innerText()).toBe("Label B");
    } finally {
      await fixture.close();
    }
  });

  it("counts and selects a repeated text list without a multi-second scan", async () => {
    const page = await firstPage(stagehand);
    const rows = 10_000;
    await page.goto(`data:text/html,${encodeURIComponent("<main id='root'></main>")}`);
    await page.evaluate((count) => {
      document.querySelector("#root")!.innerHTML = Array.from(
        { length: count },
        (_, index) => `<div><button>Repeated label ${index}</button></div>`,
      ).join("");
    }, rows);

    const matches = page.locator("text=Repeated label");
    const countStarted = performance.now();
    expect(await matches.count()).toBe(rows);
    expect(performance.now() - countStarted).toBeLessThan(5_000);

    const nthStarted = performance.now();
    expect(await matches.nth(2).innerText()).toBe("Repeated label 2");
    expect(performance.now() - nthStarted).toBeLessThan(5_000);
  });
});

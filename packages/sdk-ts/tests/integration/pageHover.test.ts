import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Stagehand } from "../../src/index.js";
import { closeStagehand, createStagehand, firstPage } from "./_support.js";

describe("Page.hover() - mouse hover at coordinates", () => {
  let stagehand: Stagehand;

  beforeEach(async () => {
    stagehand = await createStagehand();
  });

  afterEach(async () => {
    await closeStagehand(stagehand);
  });

  it("hover triggers mouseover event at coordinates", async () => {
    const page = await firstPage(stagehand);

    await page.goto(
      "data:text/html," +
        encodeURIComponent(
          `<!doctype html><html><body style="margin: 0; padding: 0;">
            <div id="target"
                 style="position: absolute; top: 100px; left: 100px; width: 200px; height: 200px; background: lightblue;"
                 onmouseover="this.dataset.hovered='true'"
                 onmouseout="this.dataset.hovered='false'">
              Hover Me
            </div>
          </body></html>`,
        ),
    );

    // Check initial state
    let hovered = await page.evaluate(() => {
      const el = document.getElementById("target");
      return el?.dataset.hovered === "true";
    });
    expect(hovered).toBe(false);

    // Hover at coordinates within the target element (200, 200 is center of the div)
    await page.hover(200, 200);

    // Verify mouseover was triggered
    hovered = await page.evaluate(() => {
      const el = document.getElementById("target");
      return el?.dataset.hovered === "true";
    });
    expect(hovered).toBe(true);
  });

  it("hover moves mouse without clicking", async () => {
    const page = await firstPage(stagehand);

    await page.goto(
      "data:text/html," +
        encodeURIComponent(
          `<!doctype html><html><body style="margin: 0; padding: 0;">
            <button id="btn"
                    style="position: absolute; top: 100px; left: 100px; width: 200px; height: 100px;"
                    onclick="this.dataset.clicked='true'"
                    onmouseover="this.dataset.hovered='true'">
              Click Me
            </button>
          </body></html>`,
        ),
    );

    // Hover over the button
    await page.hover(200, 150);

    // Check that hover happened but click did not
    const state = await page.evaluate(() => {
      const btn = document.getElementById("btn");
      return {
        hovered: btn?.dataset.hovered === "true",
        clicked: btn?.dataset.clicked === "true",
      };
    });

    expect(state.hovered).toBe(true);
    expect(state.clicked).toBe(false);
  });

  it("hover triggers CSS :hover styles", async () => {
    const page = await firstPage(stagehand);

    await page.goto(
      "data:text/html," +
        encodeURIComponent(
          `<!doctype html><html>
          <head>
            <style>
              #hoverable {
                position: absolute;
                top: 100px;
                left: 100px;
                width: 200px;
                height: 200px;
                background: red;
              }
              #hoverable:hover {
                background: green;
              }
            </style>
          </head>
          <body style="margin: 0; padding: 0;">
            <div id="hoverable">Hover to change color</div>
          </body></html>`,
        ),
    );

    // Get initial background color
    let bgColor = await page.evaluate(() => {
      const el = document.getElementById("hoverable");
      return getComputedStyle(el!).backgroundColor;
    });
    expect(bgColor).toBe("rgb(255, 0, 0)"); // red

    // Hover over the element
    await page.hover(200, 200);

    // Check that CSS :hover state is applied
    bgColor = await page.evaluate(() => {
      const el = document.getElementById("hoverable");
      return getComputedStyle(el!).backgroundColor;
    });
    expect(bgColor).toBe("rgb(0, 128, 0)"); // green
  });

  it("multiple hovers move the mouse correctly", async () => {
    const page = await firstPage(stagehand);

    await page.goto(
      "data:text/html," +
        encodeURIComponent(
          `<!doctype html><html><body style="margin: 0; padding: 0;">
            <div id="box1"
                 style="position: absolute; top: 0; left: 0; width: 100px; height: 100px; background: red;"
                 onmouseover="this.dataset.hovered='true'"
                 onmouseout="this.dataset.hovered='false'">
              Box 1
            </div>
            <div id="box2"
                 style="position: absolute; top: 0; left: 200px; width: 100px; height: 100px; background: blue;"
                 onmouseover="this.dataset.hovered='true'"
                 onmouseout="this.dataset.hovered='false'">
              Box 2
            </div>
          </body></html>`,
        ),
    );

    // Hover over box1
    await page.hover(50, 50);

    let state = await page.evaluate(() => ({
      box1: document.getElementById("box1")?.dataset.hovered === "true",
      box2: document.getElementById("box2")?.dataset.hovered === "true",
    }));

    expect(state.box1).toBe(true);
    expect(state.box2).toBe(false);

    // Move hover to box2
    await page.hover(250, 50);

    state = await page.evaluate(() => ({
      box1: document.getElementById("box1")?.dataset.hovered === "true",
      box2: document.getElementById("box2")?.dataset.hovered === "true",
    }));

    expect(state.box1).toBe(false);
    expect(state.box2).toBe(true);
  });
});

import { test, expect } from "@playwright/test";
import type { Protocol } from "devtools-protocol";
import { V3 } from "../../lib/v3/v3.js";
import { locatorScriptSources } from "../../lib/v3/dom/build/locatorScripts.generated.js";
import type { ClickablePointResult } from "../../lib/v3/dom/locatorScripts/scripts.js";
import type { Locator } from "../../lib/v3/understudy/locator.js";
import { v3TestConfig } from "./v3.config.js";
import { closeV3 } from "./testUtils.js";

/**
 * Exercises the in-page `findClickablePoint` script directly (the way
 * Locator will call it): which point on an element a real click would reach,
 * and how the element gets scrolled to find one.
 */

const html = (body: string, head = "") =>
  `data:text/html,${encodeURIComponent(`<!doctype html>
<html>
  <head><meta charset="utf-8" />${head}</head>
  <body style="margin: 0">${body}</body>
</html>`)}`;

// Same layout as the reported bug: a button whose bottom edge sits just below
// the fold, and a 36px fixed footer. A minimal scroll leaves its center under
// the footer.
const footerBody = `
  <button id="target" style="display: block; margin: calc(100vh - 50px) 0 0 40px; width: 320px; height: 60px">
    Confirm
  </button>
  <div id="footer" style="position: fixed; left: 0; right: 0; bottom: 0; height: 36px; background: rgba(0,0,0,.5)"></div>
  <div style="height: 400px"></div>
`;

async function findClickablePoint(
  locator: Locator,
): Promise<ClickablePointResult | null> {
  const session = locator.getFrame().session;
  const { objectId } = await locator.resolveNode();
  try {
    // Mirror Locator: the DOM-level scroll happens before the script runs.
    await session.send("DOM.scrollIntoViewIfNeeded", { objectId });
    const res = await session.send<Protocol.Runtime.CallFunctionOnResponse>(
      "Runtime.callFunctionOn",
      {
        objectId,
        functionDeclaration: locatorScriptSources.findClickablePoint,
        returnByValue: true,
      },
    );
    return res.result.value as ClickablePointResult | null;
  } finally {
    await session.send("Runtime.releaseObject", { objectId }).catch(() => {});
  }
}

test.describe("findClickablePoint (locator script)", () => {
  let v3: V3;

  test.beforeEach(async () => {
    v3 = new V3(v3TestConfig);
    await v3.init();
  });

  test.afterEach(async () => {
    await closeV3(v3);
  });

  const page = () => v3.context.pages()[0];
  const scrollY = () => page().evaluate(() => window.scrollY);
  // What is on top at the center of #id right now, as "#id" (or tag name).
  const topAtCenterOf = (id: string) =>
    page().evaluate((targetId) => {
      const r = document.getElementById(targetId)!.getBoundingClientRect();
      const hit = document.elementFromPoint(
        r.left + r.width / 2,
        r.top + r.height / 2,
      );
      return hit?.id ? `#${hit.id}` : hit?.tagName.toLowerCase();
    }, id);

  test("returns the center without scrolling when nothing covers it", async () => {
    await page().goto(
      html(`<button id="target" style="margin: 100px">Plain</button>`),
    );

    const result = await findClickablePoint(page().locator("#target"));

    expect(result).toEqual({ status: "ok", fx: 0.5, fy: 0.5 });
    expect(await scrollY()).toBe(0);
  });

  test("scrolls a button out from under a fixed footer", async () => {
    await page().goto(html(footerBody));

    const result = await findClickablePoint(page().locator("#target"));

    expect(result).toEqual({ status: "ok", fx: 0.5, fy: 0.5 });
    expect(await topAtCenterOf("target")).toBe("#target");
  });

  test("measures after scrolling on a smooth-scrolling page", async () => {
    await page().goto(
      html(footerBody, `<style>html { scroll-behavior: smooth; }</style>`),
    );

    const result = await findClickablePoint(page().locator("#target"));

    // Had the scroll animated, the page would still be mid-scroll here and
    // the button's center still under the footer.
    expect(result).toEqual({ status: "ok", fx: 0.5, fy: 0.5 });
    expect(await topAtCenterOf("target")).toBe("#target");
  });

  test("falls back to an off-center point when scrolling can't help", async () => {
    // Both are position: fixed, so no scroll position uncovers the center.
    // The badge covers the button's whole middle column, so the first
    // off-center point that is clear is the one left of center.
    await page().goto(
      html(`
        <button id="target" style="position: fixed; top: 100px; left: 100px; width: 200px; height: 100px">Fixed</button>
        <div id="badge" style="position: fixed; top: 105px; left: 175px; width: 50px; height: 90px; background: red"></div>
      `),
    );

    const result = await findClickablePoint(page().locator("#target"));

    expect(result).toEqual({ status: "ok", fx: 0.25, fy: 0.5 });
  });

  test("reports what covers an element with no reachable point", async () => {
    await page().goto(
      html(`
        <button id="target" style="margin: 100px">Behind the modal</button>
        <div id="modal" style="position: fixed; inset: 0; background: rgba(0,0,0,.5)"></div>
      `),
    );

    const result = await findClickablePoint(page().locator("#target"));

    expect(result).toEqual({ status: "covered", coveredBy: "div#modal" });
  });

  for (const mode of ["open", "closed"] as const) {
    test(`reaches a button inside a ${mode} shadow root`, async () => {
      await page().goto(
        html(`
          <shadow-host id="host" style="display: block; margin: 100px"></shadow-host>
          <script>
            document.getElementById("host").attachShadow({ mode: "${mode}" }).innerHTML =
              '<button id="inner"><span>Shadow</span></button>';
          </script>
        `),
      );

      const result = await findClickablePoint(page().locator("#inner"));

      expect(result).toEqual({ status: "ok", fx: 0.5, fy: 0.5 });
    });
  }

  test("counts a hit on the input's label as reaching the input", async () => {
    await page().goto(
      html(`
        <label style="position: relative; display: inline-block; margin: 100px; padding-left: 28px">
          <input type="checkbox" id="target" style="position: absolute; left: 0; top: 0; width: 20px; height: 20px; margin: 0; opacity: 0" />
          <span style="position: absolute; left: 0; top: 0; width: 20px; height: 20px; border: 1px solid #555"></span>
          Email me
        </label>
      `),
    );
    expect(await topAtCenterOf("target")).toBe("span");

    const result = await findClickablePoint(page().locator("#target"));

    expect(result).toEqual({ status: "ok", fx: 0.5, fy: 0.5 });
  });
});

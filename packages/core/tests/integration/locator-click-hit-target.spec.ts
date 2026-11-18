import { test, expect } from "@playwright/test";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { V3 } from "../../lib/v3/v3.js";
import { v3TestConfig } from "./v3.config.js";
import { closeV3 } from "./testUtils.js";

/**
 * locator.click() hit-tests before clicking: it looks for a point on the
 * element that no other element covers, scrolling if needed.
 *
 * Covered targets: fixed footers, sticky headers, and fully covered elements
 * (which fall back to clicking the center). Also guarded: targets where the
 * element under the click point is legitimately not the target itself:
 * shadow DOM (hit-testing retargets to the host), native inputs hidden under
 * their label, iframes (coordinates must be translated to the top-level
 * viewport), and smooth-scrolling pages.
 *
 * Each fixture records clicks in `window.clicked` (ids of elements whose own
 * click listener fired), so assertions check the intended element received
 * the click rather than just that nothing threw.
 */

const doc = (body: string, head = "") => `<!doctype html>
<html>
  <head><meta charset="utf-8" />${head}</head>
  <body style="margin: 0">
    <script>window.clicked = [];</script>
    ${body}
  </body>
</html>`;

const html = (body: string, head = "") =>
  `data:text/html,${encodeURIComponent(doc(body, head))}`;

// Pushes `id` onto window.clicked when the element is clicked.
const recordClick = (expr: string, id: string) =>
  `${expr}.addEventListener("click", () => window.clicked.push(${JSON.stringify(id)}));`;

const shadowFixture = (mode: "open" | "closed") =>
  html(`
    <div style="height: 120px"></div>
    <shadow-host id="host"></shadow-host>
    <script>
      const root = document.getElementById("host").attachShadow({ mode: "${mode}" });
      root.innerHTML =
        '<div style="padding: 8px"><button id="shadow-btn" style="width: 200px; height: 48px">' +
        '<span>Shadow button</span></button></div>';
      ${recordClick('root.getElementById("shadow-btn")', "shadow-btn")}
    </script>
  `);

// Bootstrap 4 "custom-control" pattern: the native checkbox sits behind
// (z-index: -1) a pseudo-element drawn by its label.
const bootstrapCheckboxFixture = html(
  `
    <div style="height: 120px"></div>
    <div class="custom-control">
      <input type="checkbox" class="custom-control-input" id="agree" />
      <label class="custom-control-label" for="agree">I agree</label>
    </div>
  `,
  `<style>
    .custom-control { position: relative; z-index: 1; display: block; min-height: 24px; padding-left: 32px; margin-left: 40px; }
    .custom-control-input { position: absolute; left: 0; z-index: -1; width: 20px; height: 24px; opacity: 0; margin: 0; }
    .custom-control-label { position: relative; display: inline-block; line-height: 24px; }
    .custom-control-label::before {
      content: ""; position: absolute; top: 2px; left: -32px; width: 20px; height: 20px;
      border: 1px solid #555; border-radius: 4px; background: white;
    }
  </style>`,
);

// Native checkbox made invisible and covered by a styled sibling inside the
// same <label>.
const wrappedCheckboxFixture = html(
  `
    <div style="height: 120px"></div>
    <label class="toggle">
      <input type="checkbox" id="notify" />
      <span class="box"></span>
      Email me
    </label>
  `,
  `<style>
    .toggle { position: relative; display: inline-flex; align-items: center; gap: 8px; margin-left: 40px; padding-left: 28px; }
    .toggle input { position: absolute; left: 0; top: 0; width: 20px; height: 20px; margin: 0; opacity: 0; }
    .toggle .box { position: absolute; left: 0; top: 0; width: 20px; height: 20px; border: 1px solid #555; background: white; }
  </style>`,
);

// Smooth scrolling on the root, with the target far below the fold.
const smoothScrollFixture = html(
  `
    <div style="height: 2500px"></div>
    <button id="far-btn" style="width: 200px; height: 48px; margin-left: 40px">Far button</button>
    <div style="height: 2500px"></div>
    <script>${recordClick('document.getElementById("far-btn")', "far-btn")}</script>
  `,
  `<style>html { scroll-behavior: smooth; }</style>`,
);

// The reported bug: the button's bottom edge sits just below the fold, so
// scrollIntoViewIfNeeded scrolls it only until its bottom edge is visible,
// which leaves its center under a 36px fixed footer.
const fixedFooterFixture = html(`
  <button id="confirm" style="display: block; margin: calc(100vh - 50px) 0 0 40px; width: 320px; height: 60px">Confirm</button>
  <div id="footer" style="position: fixed; left: 0; right: 0; bottom: 0; height: 36px; background: rgba(20,20,20,.55)">
    <button id="help" style="height: 28px; margin: 4px 40px; float: right">Help</button>
  </div>
  <div style="height: 400px"></div>
  <script>
    ${recordClick('document.getElementById("confirm")', "confirm")}
    ${recordClick('document.getElementById("footer")', "footer")}
    window.hovered = [];
    for (const id of ["confirm", "footer"]) {
      document.getElementById(id).addEventListener("mouseover", (e) => {
        if (e.target.id === id) window.hovered.push(id);
      });
    }
  </script>
`);

// A 60px sticky header and a button scrolled 10px past the top of the
// viewport. It is partly visible, so scrollIntoViewIfNeeded only aligns its
// top edge with the top of the viewport, leaving it under the header. (A
// button fully out of view would be centered instead, missing the bug.)
const stickyHeaderFixture = html(`
  <div id="header" style="position: sticky; top: 0; height: 60px; background: #333; z-index: 1"></div>
  <div style="height: 300px"></div>
  <button id="save" style="display: block; margin-left: 40px; width: 200px; height: 40px">Save</button>
  <div style="height: 3000px"></div>
  <script>
    ${recordClick('document.getElementById("save")', "save")}
    ${recordClick('document.getElementById("header")', "header")}
    // The button starts at 60 (header) + 300 (spacer) = 360px.
    window.scrollTo(0, 370);
  </script>
`);

// A full-screen modal over the button: no point on it is reachable.
const modalFixture = html(`
  <button id="behind" style="margin: 100px">Behind the modal</button>
  <div id="modal" style="position: fixed; inset: 0; background: rgba(0,0,0,.5)"></div>
  <script>
    ${recordClick('document.getElementById("behind")', "behind")}
    ${recordClick('document.getElementById("modal")', "modal")}
  </script>
`);

// Iframe content: a button partway down the frame that reports clicks to the
// top-level page via postMessage (works for same- and cross-origin frames).
const iframeContent = `<!doctype html>
<html>
  <body style="margin: 0">
    <div style="height: 900px"></div>
    <button id="frame-btn" style="width: 200px; height: 48px; margin-left: 24px">Frame button</button>
    <div style="height: 300px"></div>
    <script>
      document.getElementById("frame-btn").addEventListener("click", () =>
        window.top.postMessage("frame-btn", "*"),
      );
    </script>
  </body>
</html>`;

const iframeHost = (iframeAttrs: string) =>
  doc(`
    <div style="height: 200px"></div>
    <iframe id="frame" ${iframeAttrs}
      style="width: 600px; height: 300px; margin-left: 30px; border: 6px solid #333"></iframe>
    <div style="height: 1200px"></div>
    <script>
      window.addEventListener("message", (e) => window.clicked.push(e.data));
    </script>
  `);

test.describe("locator.click() hit target", () => {
  let v3: V3;

  test.beforeEach(async () => {
    v3 = new V3(v3TestConfig);
    await v3.init();
  });

  test.afterEach(async () => {
    await closeV3(v3);
  });

  const clickedIds = async () => {
    const page = v3.context.pages()[0];
    return page.evaluate(
      () => (window as unknown as { clicked: string[] }).clicked,
    );
  };

  // Fixture sanity check: the id of whatever is on top at the center of `#id`.
  // Lets the checkbox tests prove the input really is covered, so they keep
  // exercising the hidden-input case if the fixture CSS drifts.
  const topElementAtCenterOf = async (id: string) => {
    const page = v3.context.pages()[0];
    return page.evaluate((targetId) => {
      const r = document.getElementById(targetId)!.getBoundingClientRect();
      const hit = document.elementFromPoint(
        r.left + r.width / 2,
        r.top + r.height / 2,
      );
      return hit?.id || hit?.className || hit?.tagName;
    }, id);
  };

  test("clicks a button partly under a fixed footer", async () => {
    const page = v3.context.pages()[0];
    await page.goto(fixedFooterFixture);

    await page.locator("#confirm").click();

    expect(await clickedIds()).toEqual(["confirm"]);
  });

  test("hovers a button partly under a fixed footer", async () => {
    const page = v3.context.pages()[0];
    await page.goto(fixedFooterFixture);

    await page.locator("#confirm").hover();

    expect(
      await page.evaluate(
        () => (window as unknown as { hovered: string[] }).hovered,
      ),
    ).toEqual(["confirm"]);
  });

  test("taps a button partly under a fixed footer with trusted touch", async () => {
    const page = v3.context.pages()[0];
    await page.goto(fixedFooterFixture);
    // Record touch/pointer events on the button and the footer covering it.
    // Mirrors the probe in perform-understudy-method.spec.ts. Chromium follows
    // a tap with compatibility mouse events, so the check is that the pointer
    // events are touch, not that no mouse events fire.
    await page.evaluate(() => {
      const w = window as unknown as { touchEvents: string[] };
      w.touchEvents = [];
      for (const id of ["confirm", "footer"]) {
        const el = document.getElementById(id)!;
        for (const type of ["touchstart", "touchend", "pointerdown"]) {
          el.addEventListener(type, (e) => {
            if ((e.target as Element).id !== id) return;
            const pointerType = (e as PointerEvent).pointerType;
            w.touchEvents.push(
              `${id}:${type}` +
                (pointerType ? `:${pointerType}` : "") +
                (e.isTrusted ? "" : ":untrusted"),
            );
          });
        }
      }
    });

    await page.locator("#confirm").tap();

    const events = await page.evaluate(
      () => (window as unknown as { touchEvents: string[] }).touchEvents,
    );
    expect(events).toContain("confirm:pointerdown:touch");
    expect(events).toContain("confirm:touchstart");
    expect(events).toContain("confirm:touchend");
    expect(events.indexOf("confirm:touchstart")).toBeLessThan(
      events.indexOf("confirm:touchend"),
    );
    expect(events.filter((e) => e.startsWith("footer:"))).toEqual([]);
  });

  test("centroid() stays at the box center even when it is covered", async () => {
    const page = v3.context.pages()[0];
    await page.goto(fixedFooterFixture);

    // centroid() promises the center, so unlike click() it must not move to a
    // point that isn't covered: here the center stays under the footer.
    const { x, y } = await page.locator("#confirm").centroid();

    const expected = await page.evaluate(() => {
      const el = document.getElementById("confirm")!;
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      const px = (v: string) => parseFloat(v) || 0;
      // Content-box center, matching the BoxModel content quad.
      const left = r.left + px(s.borderLeftWidth) + px(s.paddingLeft);
      const right = r.right - px(s.borderRightWidth) - px(s.paddingRight);
      const top = r.top + px(s.borderTopWidth) + px(s.paddingTop);
      const bottom = r.bottom - px(s.borderBottomWidth) - px(s.paddingBottom);
      const cx = (left + right) / 2;
      const cy = (top + bottom) / 2;
      return {
        x: Math.round(cx),
        y: Math.round(cy),
        top: document.elementFromPoint(cx, cy)?.id,
      };
    });
    expect({ x, y }).toEqual({ x: expected.x, y: expected.y });
    expect(expected.top).toBe("footer");
  });

  test("clicks a button that scrolls in under a sticky header", async () => {
    const page = v3.context.pages()[0];
    await page.goto(stickyHeaderFixture);

    await page.locator("#save").click();

    expect(await clickedIds()).toEqual(["save"]);
  });

  test("still clicks the center of a fully covered element", async () => {
    const page = v3.context.pages()[0];
    await page.goto(modalFixture);

    // No uncovered point exists, so click() falls back to the center (the
    // pre-hit-testing behavior) instead of throwing; the modal gets the click.
    await page.locator("#behind").click();

    expect(await clickedIds()).toEqual(["modal"]);
  });

  for (const mode of ["open", "closed"] as const) {
    test(`clicks a button inside a ${mode} shadow root`, async () => {
      const page = v3.context.pages()[0];
      await page.goto(shadowFixture(mode));

      await page.locator("#shadow-btn").click();

      expect(await clickedIds()).toEqual(["shadow-btn"]);
    });
  }

  test("checks a checkbox hidden behind its label's pseudo-element", async () => {
    const page = v3.context.pages()[0];
    await page.goto(bootstrapCheckboxFixture);
    expect(await topElementAtCenterOf("agree")).toBe("custom-control-label");

    await page.locator("#agree").click();

    expect(await page.locator("#agree").isChecked()).toBe(true);
  });

  test("checks a checkbox covered by a sibling inside its label", async () => {
    const page = v3.context.pages()[0];
    await page.goto(wrappedCheckboxFixture);
    expect(await topElementAtCenterOf("notify")).toBe("box");

    await page.locator("#notify").click();

    expect(await page.locator("#notify").isChecked()).toBe(true);
  });

  test("clicks a button far below the fold on a smooth-scrolling page", async () => {
    const page = v3.context.pages()[0];
    await page.goto(smoothScrollFixture);

    await page.locator("#far-btn").click();

    expect(await clickedIds()).toEqual(["far-btn"]);
  });

  test("clicks a button inside a same-origin iframe", async () => {
    const page = v3.context.pages()[0];
    await page.goto(
      `data:text/html,${encodeURIComponent(
        iframeHost(`srcdoc="${iframeContent.replace(/"/g, "&quot;")}"`),
      )}`,
    );

    await page.frameLocator("#frame").locator("#frame-btn").click();

    await expect.poll(clickedIds).toEqual(["frame-btn"]);
  });

  test.describe("cross-origin iframe", () => {
    // One local server, reached under two hostnames: the top-level page loads
    // from `localhost` and the iframe from `127.0.0.1`. Those are different
    // sites, so Chrome puts the iframe in its own process (OOPIF).
    let server: Server | null = null;
    let port = 0;

    test.beforeAll(async () => {
      server = createServer((req, res) => {
        res.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
        });
        res.end(
          req.url === "/frame"
            ? iframeContent
            : iframeHost(`src="http://127.0.0.1:${port}/frame"`),
        );
      });
      await new Promise<void>((resolve) => {
        // No host: listen on all interfaces so both hostnames reach it.
        server?.listen(0, () => {
          port = (server?.address() as AddressInfo).port;
          resolve();
        });
      });
    });

    test.afterAll(async () => {
      await new Promise<void>((resolve) => {
        if (!server) return resolve();
        server.close(() => resolve());
      });
      server = null;
    });

    test("clicks a button inside a cross-origin iframe", async () => {
      test.skip(
        v3.isBrowserbase,
        "remote browser cannot reach the local fixture server",
      );
      const page = v3.context.pages()[0];
      await page.goto(`http://localhost:${port}/`, { waitUntil: "load" });
      // Fixture sanity check: the parent cannot reach into the frame.
      expect(
        await page.evaluate(
          () =>
            (document.getElementById("frame") as HTMLIFrameElement)
              .contentDocument === null,
        ),
      ).toBe(true);

      await page.frameLocator("#frame").locator("#frame-btn").click();

      await expect.poll(clickedIds).toEqual(["frame-btn"]);
    });
  });
});

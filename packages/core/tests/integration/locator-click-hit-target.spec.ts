import { test, expect } from "@playwright/test";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { V3 } from "../../lib/v3/v3.js";
import { v3TestConfig } from "./v3.config.js";
import { closeV3 } from "./testUtils.js";

/**
 * Guards for locator.click() on targets where the element under the click
 * point is not simply the target itself: shadow DOM (hit-testing retargets to
 * the host), native inputs hidden under their label, iframes (coordinates must
 * be translated to the top-level viewport), and smooth-scrolling pages.
 *
 * These all pass with the current scroll-then-click-the-center behavior and
 * must keep passing once click() starts hit-testing before it clicks.
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

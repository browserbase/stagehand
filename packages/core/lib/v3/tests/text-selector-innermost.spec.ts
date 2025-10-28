import { expect, test } from "@playwright/test";
import { Protocol } from "devtools-protocol";
import { V3 } from "../v3";
import { v3DynamicTestConfig } from "./v3.dynamic.config";

test.describe("Text selector innermost element matching", () => {
  let v3: V3;

  test.beforeEach(async () => {
    v3 = new V3(v3DynamicTestConfig);
    await v3.init();
  });

  test.afterEach(async () => {
    await v3?.close?.().catch(() => {});
  });

  test("text selector matches only innermost elements", async () => {
    const page = v3.context.pages()[0];

    await page.goto(
      "data:text/html," +
        encodeURIComponent(`
        <div id="outer">
          <span id="middle">
            <button id="inner">Click me</button>
          </span>
        </div>
      `),
    );

    // Only the button should be counted, not the parent elements
    const count = await page.mainFrame().locator("text=Click me").count();
    expect(count).toBe(1);

    // Verify it finds the button element specifically
    const session = page.mainFrame().session;
    const { executionContextId } = await session.send<{
      executionContextId: number;
    }>("Page.createIsolatedWorld", {
      frameId: page.mainFrame().frameId,
      worldName: "test-world",
    });

    const evalRes = await session.send<Protocol.Runtime.EvaluateResponse>(
      "Runtime.evaluate",
      {
        expression: `(() => {
          const candidates = [];
          const iter = document.createNodeIterator(document.documentElement, NodeFilter.SHOW_ELEMENT);
          let n;
          while ((n = iter.nextNode())) {
            const el = n;
            const t = (el.innerText ?? el.textContent ?? '').trim();
            if (t && t.includes("Click me")) {
              candidates.push(el);
            }
          }
          
          // Find innermost
          for (const candidate of candidates) {
            let isInnermost = true;
            for (const other of candidates) {
              if (candidate !== other && candidate.contains(other)) {
                isInnermost = false;
                break;
              }
            }
            if (isInnermost) return candidate.id;
          }
          return null;
        })()`,
        contextId: executionContextId,
        returnByValue: true,
      },
    );

    expect(evalRes.result.value).toBe("inner");
  });

  test("multiple innermost elements with same text", async () => {
    const page = v3.context.pages()[0];

    await page.goto(
      "data:text/html," +
        encodeURIComponent(`
        <div>
          <button>Submit</button>
          <span>Some other content</span>
          <button>Submit</button>
        </div>
        <div>
          <a href="#">Submit</a>
        </div>
      `),
    );

    // Should find all three innermost elements (2 buttons + 1 link)
    const count = await page.mainFrame().locator("text=Submit").count();
    expect(count).toBe(3);
  });

  test("nested text with different innermost elements", async () => {
    const page = v3.context.pages()[0];

    await page.goto(
      "data:text/html," +
        encodeURIComponent(`
        <div id="parent">
          Hello <span id="child">World</span>
        </div>
      `),
    );

    // "Hello" is only in the parent div
    const helloCount = await page.mainFrame().locator("text=Hello").count();
    expect(helloCount).toBe(1); // Only the div

    // "World" is only in the span
    const worldCount = await page.mainFrame().locator("text=World").count();
    expect(worldCount).toBe(1); // Only the span

    // "Hello World" matches only the parent div (as it's the innermost containing both words)
    const bothCount = await page
      .mainFrame()
      .locator("text=Hello World")
      .count();
    expect(bothCount).toBe(1); // Only the div
  });
});

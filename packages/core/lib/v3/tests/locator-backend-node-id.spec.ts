import { test, expect } from "@playwright/test";
import { V3 } from "../v3";
import { v3TestConfig } from "./v3.config";

test.describe("Locator.backendNodeId() - CDP DOM node ID", () => {
  let v3: V3;

  test.beforeEach(async () => {
    v3 = new V3(v3TestConfig);
    await v3.init();
  });

  test.afterEach(async () => {
    await v3?.close?.().catch(() => {});
  });

  test("returns a valid backend node ID for an element", async () => {
    const page = v3.context.pages()[0];

    await page.goto(
      "data:text/html," +
        encodeURIComponent(
          `<!doctype html><html><body>
            <button id="btn">Click me</button>
          </body></html>`,
        ),
    );

    const locator = page.locator("button#btn");
    const nodeId = await locator.backendNodeId();

    // Backend node ID should be a valid number
    expect(typeof nodeId).toBe("number");
    expect(nodeId).toBeGreaterThan(0);
  });

  test("returns different node IDs for different elements", async () => {
    const page = v3.context.pages()[0];

    await page.goto(
      "data:text/html," +
        encodeURIComponent(
          `<!doctype html><html><body>
            <div id="div1">First</div>
            <div id="div2">Second</div>
            <p id="p1">Third</p>
          </body></html>`,
        ),
    );

    const nodeId1 = await page.locator("div#div1").backendNodeId();
    const nodeId2 = await page.locator("div#div2").backendNodeId();
    const nodeId3 = await page.locator("p#p1").backendNodeId();

    // All node IDs should be unique
    expect(nodeId1).not.toBe(nodeId2);
    expect(nodeId2).not.toBe(nodeId3);
    expect(nodeId1).not.toBe(nodeId3);
  });

  test("returns consistent node ID for the same element", async () => {
    const page = v3.context.pages()[0];

    await page.goto(
      "data:text/html," +
        encodeURIComponent(
          `<!doctype html><html><body>
            <input type="text" id="input" />
          </body></html>`,
        ),
    );

    const locator = page.locator("input#input");

    // Call multiple times on the same element
    const nodeId1 = await locator.backendNodeId();
    const nodeId2 = await locator.backendNodeId();

    // Should return the same ID (same element)
    expect(nodeId1).toBe(nodeId2);
  });

  test("returns node ID for nested elements", async () => {
    const page = v3.context.pages()[0];

    await page.goto(
      "data:text/html," +
        encodeURIComponent(
          `<!doctype html><html><body>
            <div id="outer">
              <div id="middle">
                <span id="inner">Deep</span>
              </div>
            </div>
          </body></html>`,
        ),
    );

    const outerNodeId = await page.locator("div#outer").backendNodeId();
    const middleNodeId = await page.locator("div#middle").backendNodeId();
    const innerNodeId = await page.locator("span#inner").backendNodeId();

    // All should be valid and unique
    expect(outerNodeId).toBeGreaterThan(0);
    expect(middleNodeId).toBeGreaterThan(0);
    expect(innerNodeId).toBeGreaterThan(0);
    expect(new Set([outerNodeId, middleNodeId, innerNodeId]).size).toBe(3);
  });

  test("returns node ID for elements with various attributes", async () => {
    const page = v3.context.pages()[0];

    await page.goto(
      "data:text/html," +
        encodeURIComponent(
          `<!doctype html><html><body>
            <button class="btn primary" data-test="submit" aria-label="Submit form">Save</button>
          </body></html>`,
        ),
    );

    const locator = page.locator("button");
    const nodeId = await locator.backendNodeId();

    // Should work with complex elements
    expect(typeof nodeId).toBe("number");
    expect(nodeId).toBeGreaterThan(0);
  });

  test("returns node ID for form elements", async () => {
    const page = v3.context.pages()[0];

    await page.goto(
      "data:text/html," +
        encodeURIComponent(
          `<!doctype html><html><body>
            <form>
              <input type="email" id="email" placeholder="Email" />
              <textarea id="message"></textarea>
              <select id="country">
                <option value="us">USA</option>
                <option value="ca">Canada</option>
              </select>
              <button type="submit">Submit</button>
            </form>
          </body></html>`,
        ),
    );

    const emailNodeId = await page.locator("input#email").backendNodeId();
    const textareaNodeId = await page
      .locator("textarea#message")
      .backendNodeId();
    const selectNodeId = await page.locator("select#country").backendNodeId();
    const submitNodeId = await page
      .locator("button[type='submit']")
      .backendNodeId();

    // All form elements should have valid node IDs
    expect(emailNodeId).toBeGreaterThan(0);
    expect(textareaNodeId).toBeGreaterThan(0);
    expect(selectNodeId).toBeGreaterThan(0);
    expect(submitNodeId).toBeGreaterThan(0);

    // All should be unique
    const nodeIds = [emailNodeId, textareaNodeId, selectNodeId, submitNodeId];
    expect(new Set(nodeIds).size).toBe(4);
  });

  test("returns node ID for dynamically created elements", async () => {
    const page = v3.context.pages()[0];

    await page.goto(
      "data:text/html," +
        encodeURIComponent(
          `<!doctype html><html><body>
            <div id="container"></div>
            <script>
              const container = document.getElementById('container');
              const newBtn = document.createElement('button');
              newBtn.id = 'dynamic-btn';
              newBtn.textContent = 'Dynamically created';
              container.appendChild(newBtn);
            </script>
          </body></html>`,
        ),
    );

    const locator = page.locator("button#dynamic-btn");
    const nodeId = await locator.backendNodeId();

    // Should work with dynamically created elements
    expect(typeof nodeId).toBe("number");
    expect(nodeId).toBeGreaterThan(0);
  });

  test("returns node ID for elements with text selectors", async () => {
    const page = v3.context.pages()[0];

    await page.goto(
      "data:text/html," +
        encodeURIComponent(
          `<!doctype html><html><body>
            <button>Submit Form</button>
          </body></html>`,
        ),
    );

    const locator = page.locator("text=Submit Form");
    const nodeId = await locator.backendNodeId();

    // Should work with text-based selectors
    expect(typeof nodeId).toBe("number");
    expect(nodeId).toBeGreaterThan(0);
  });
});

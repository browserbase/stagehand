import { test, expect } from "@playwright/test";
import { V3 } from "../v3";
import { v3TestConfig } from "./v3.config";

test.describe("Page.snapshot", () => {
  let v3: V3;

  test.beforeEach(async () => {
    v3 = new V3(v3TestConfig);
    await v3.init();
  });

  test.afterEach(async () => {
    await v3?.close?.().catch(() => {});
  });

  test("returns a hybrid snapshot with combined tree and maps", async () => {
    const page = v3.context.pages()[0];

    const html = `
      <!doctype html>
      <html>
        <head><title>Snapshot Test</title></head>
        <body>
          <h1>Hello World</h1>
          <button id="submit-btn">Submit</button>
          <a href="https://example.com">Link</a>
        </body>
      </html>
    `;

    await page.goto("data:text/html," + encodeURIComponent(html));

    // Call the new snapshot method
    const snapshot = await page.snapshot();

    // Verify structure matches HybridSnapshot type
    expect(snapshot).toBeDefined();
    expect(typeof snapshot.combinedTree).toBe("string");
    expect(typeof snapshot.combinedXpathMap).toBe("object");
    expect(typeof snapshot.combinedUrlMap).toBe("object");

    // The combined tree should contain our page content
    expect(snapshot.combinedTree).toContain("Hello World");
    expect(snapshot.combinedTree).toContain("Submit");
    expect(snapshot.combinedTree).toContain("Link");

    // XPath map should have entries
    expect(Object.keys(snapshot.combinedXpathMap).length).toBeGreaterThan(0);

    // URL map should contain the link URL
    expect(Object.values(snapshot.combinedUrlMap)).toContain(
      "https://example.com/",
    );
  });

  test("supports focusSelector option to scope the snapshot", async () => {
    const page = v3.context.pages()[0];

    const html = `
      <!doctype html>
      <html>
        <head><title>Scoped Snapshot Test</title></head>
        <body>
          <div id="outside">Outside Content</div>
          <main id="main-content">
            <h2>Main Heading</h2>
            <p>Main paragraph</p>
          </main>
        </body>
      </html>
    `;

    await page.goto("data:text/html," + encodeURIComponent(html));

    // Snapshot with focusSelector should scope to that element
    const scopedSnapshot = await page.snapshot({
      focusSelector: "#main-content",
    });

    expect(scopedSnapshot).toBeDefined();
    expect(scopedSnapshot.combinedTree).toContain("Main Heading");
    expect(scopedSnapshot.combinedTree).toContain("Main paragraph");
  });

  test("supports XPath focusSelector", async () => {
    const page = v3.context.pages()[0];

    const html = `
      <!doctype html>
      <html>
        <body>
          <div id="container">
            <span>Target Text</span>
          </div>
        </body>
      </html>
    `;

    await page.goto("data:text/html," + encodeURIComponent(html));

    // Use XPath-style focusSelector
    const snapshot = await page.snapshot({
      focusSelector: "//div[@id='container']",
    });

    expect(snapshot).toBeDefined();
    expect(snapshot.combinedTree).toContain("Target Text");
  });

  test("returns perFrame data when available", async () => {
    const page = v3.context.pages()[0];

    const html = `
      <!doctype html>
      <html>
        <body>
          <p>Simple page</p>
        </body>
      </html>
    `;

    await page.goto("data:text/html," + encodeURIComponent(html));

    const snapshot = await page.snapshot();

    // perFrame should be present and contain at least one frame entry
    expect(snapshot.perFrame).toBeDefined();
    expect(Array.isArray(snapshot.perFrame)).toBe(true);
    expect(snapshot.perFrame!.length).toBeGreaterThanOrEqual(1);

    const mainFrame = snapshot.perFrame![0];
    expect(mainFrame.frameId).toBeDefined();
    expect(typeof mainFrame.outline).toBe("string");
    expect(typeof mainFrame.xpathMap).toBe("object");
    expect(typeof mainFrame.urlMap).toBe("object");
  });
});

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Stagehand } from "../../src/index.js";
import { closeStagehand, createStagehand, firstPage } from "./_support.js";

describe("Page.content", () => {
  let stagehand: Stagehand;

  beforeEach(async () => {
    stagehand = await createStagehand();
  });

  afterEach(async () => {
    await closeStagehand(stagehand);
  });

  it.each([
    "<!DOCTYPE html>",
    '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">',
    '<!DOCTYPE html SYSTEM "example.dtd">',
    "",
  ])("includes the browser-serialized doctype: %s", async (doctype) => {
    const page = await firstPage(stagehand);
    await page.goto(
      `data:text/html;charset=utf-8,${encodeURIComponent(`${doctype}<html><head><title>Content</title></head><body><p>Hello &amp; 世界</p></body></html>`)}`,
    );

    expect(await page.content()).toBe(
      `${doctype}<html><head><title>Content</title></head><body><p>Hello &amp; 世界</p></body></html>`,
    );
  });

  it("reads live main-document mutations without serializing child documents or shadow roots", async () => {
    const page = await firstPage(stagehand);
    await page.goto(
      "data:text/html,<!doctype html><p>Before</p><iframe></iframe><div id=host></div>",
    );
    await page.evaluate(() => {
      document.querySelector("p")!.textContent = "After";
      document.querySelector("iframe")!.contentDocument!.body.textContent = "Frame-only text";
      document.querySelector("#host")!.attachShadow({ mode: "open" }).innerHTML =
        "Shadow-only text";
      globalThis.XMLSerializer = class {
        serializeToString(): string {
          throw new Error("Main-world serializer must not run");
        }
      };
    });

    const html = await page.content();
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<p>After</p>");
    expect(html).toContain("<iframe></iframe>");
    expect(html).not.toContain("Before");
    expect(html).not.toContain("Frame-only text");
    expect(html).not.toContain("Shadow-only text");
  });

  it("handles a missing root and an empty document without fabricating HTML", async () => {
    const page = await firstPage(stagehand);
    await page.goto("data:text/html,<!doctype html><p>Remove me</p>");
    await page.evaluate(() => document.documentElement.remove());
    expect(await page.content()).toBe("<!DOCTYPE html>");

    await page.evaluate(() => document.doctype?.remove());
    expect(await page.content()).toBe("");
  });
});

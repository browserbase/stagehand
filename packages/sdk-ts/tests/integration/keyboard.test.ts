import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Stagehand } from "../../src/index.js";
import { closeStagehand, createStagehand, firstPage } from "./_support.js";

function dataUrl(html: string): string {
  return "data:text/html;charset=utf-8," + encodeURIComponent(html);
}

describe("v4 keyboard shortcuts and typing", () => {
  let stagehand: Stagehand;

  beforeEach(async () => {
    stagehand = await createStagehand();
  });

  afterEach(async () => {
    await closeStagehand(stagehand);
  });

  it("typing, select-all + delete clears input (Cmd maps cross-OS)", async () => {
    const html = `<!doctype html>
      <input id="i1" autofocus />`;
    const page = await firstPage(stagehand);
    await page.goto(dataUrl(html), {
      waitUntil: "domcontentloaded",
      timeout: 15000,
    });

    await page.locator("#i1").click();
    await page.type("Hello World");

    await page.keyPress("Cmd+A");
    await page.keyPress("Delete");

    const value = await page.evaluate(
      (sel) => (document.querySelector(sel) as HTMLInputElement)!.value,
      "#i1",
    );
    expect(value).toBe("");
  });

  it("accelerator does not inject printable text (Cmd+B does not type 'b')", async () => {
    const html = `<!doctype html>
      <input id="i" />`;
    const page = await firstPage(stagehand);
    await page.goto(dataUrl(html), {
      waitUntil: "domcontentloaded",
      timeout: 15000,
    });

    await page.locator("#i").click();
    await page.type("xyz");

    await page.keyPress("Cmd+B");

    const value = await page.evaluate(
      (sel) => (document.querySelector(sel) as HTMLInputElement)!.value,
      "#i",
    );
    expect(value).toBe("xyz");
  });

  it("Tab and Shift+Tab move focus", async () => {
    const html = `<!doctype html>
      <input id="a" />
      <input id="b" />`;
    const page = await firstPage(stagehand);
    await page.goto(dataUrl(html), {
      waitUntil: "domcontentloaded",
      timeout: 15000,
    });

    await page.locator("#a").click();
    await page.keyPress("Tab");
    const active1 = await page.evaluate(() => (document.activeElement as HTMLElement)?.id || "");
    expect(active1).toBe("b");

    await page.keyPress("Shift+Tab");
    const active2 = await page.evaluate(() => (document.activeElement as HTMLElement)?.id || "");
    expect(active2).toBe("a");
  });

  it("cut clears the field (Cmd+X)", async () => {
    const html = `<!doctype html>
      <input id="t" />`;
    const page = await firstPage(stagehand);
    await page.goto(dataUrl(html), {
      waitUntil: "domcontentloaded",
      timeout: 15000,
    });

    await page.locator("#t").click();
    await page.type("cut-me");
    await page.keyPress("Cmd+A");
    await page.keyPress("Cmd+X");

    const value = await page.evaluate(
      (sel) => (document.querySelector(sel) as HTMLInputElement)!.value,
      "#t",
    );
    expect(value).toBe("");
  });

  it("single printable via keyPress types characters (a, Shift+A, space)", async () => {
    const html = `<!doctype html>
      <input id="t" autofocus />`;
    const page = await firstPage(stagehand);
    await page.goto(dataUrl(html), {
      waitUntil: "domcontentloaded",
      timeout: 15000,
    });

    await page.locator("#t").click();
    await page.keyPress("a");
    await page.keyPress("Shift+A");
    await page.keyPress(" ");

    const value = await page.evaluate(
      (sel) => (document.querySelector(sel) as HTMLInputElement)!.value,
      "#t",
    );
    expect(value).toBe("aA ");
  });

  it("Backspace removes last char", async () => {
    const html = `<!doctype html>
      <input id="t" />`;
    const page = await firstPage(stagehand);
    await page.goto(dataUrl(html), {
      waitUntil: "domcontentloaded",
      timeout: 15000,
    });

    await page.locator("#t").click();
    await page.type("ab");
    await page.keyPress("Backspace");
    const value = await page.evaluate(
      (sel) => (document.querySelector(sel) as HTMLInputElement)!.value,
      "#t",
    );
    expect(value).toBe("a");
  });

  it("Delete removes next char at caret", async () => {
    const html = `<!doctype html>
      <input id="t" />`;
    const page = await firstPage(stagehand);
    await page.goto(dataUrl(html), {
      waitUntil: "domcontentloaded",
      timeout: 15000,
    });

    await page.locator("#t").click();
    await page.type("abc");
    // place caret between a|bc
    await page.evaluate(() => {
      const el = document.getElementById("t") as HTMLInputElement;
      el.focus();
      el.setSelectionRange(1, 1);
    });
    await page.keyPress("Delete");
    const value = await page.evaluate(
      (sel) => (document.querySelector(sel) as HTMLInputElement)!.value,
      "#t",
    );
    expect(value).toBe("ac");
  });

  it("ArrowLeft moves caret and typing inserts in middle", async () => {
    const html = `<!doctype html>
      <input id="t" />`;
    const page = await firstPage(stagehand);
    await page.goto(dataUrl(html), {
      waitUntil: "domcontentloaded",
      timeout: 15000,
    });

    await page.locator("#t").click();
    await page.type("ac");
    await page.keyPress("ArrowLeft");
    await page.keyPress("b");
    const value = await page.evaluate(
      (sel) => (document.querySelector(sel) as HTMLInputElement)!.value,
      "#t",
    );
    expect(value).toBe("abc");
  });

  it("Enter inserts newline in textarea", async () => {
    const html = `<!doctype html>
      <textarea id="ta"></textarea>`;
    const page = await firstPage(stagehand);
    await page.goto(dataUrl(html), {
      waitUntil: "domcontentloaded",
      timeout: 15000,
    });

    await page.locator("#ta").click();
    await page.keyPress("a");
    await page.keyPress("Enter");
    await page.keyPress("b");
    const value = await page.evaluate(
      (sel) => (document.querySelector(sel) as HTMLTextAreaElement)!.value,
      "#ta",
    );
    expect(value).toBe("a\nb");
  });

  it("Insert key (no-op for value)", async () => {
    const html = `<!doctype html>
      <input id="t" />`;
    const page = await firstPage(stagehand);
    await page.goto(dataUrl(html), {
      waitUntil: "domcontentloaded",
      timeout: 15000,
    });

    await page.locator("#t").click();
    await page.type("abc");
    await page.keyPress("Insert");
    const value = await page.evaluate(
      (sel) => (document.querySelector(sel) as HTMLInputElement)!.value,
      "#t",
    );
    expect(value).toBe("abc");
  });

  it("Enter submits form from text input", async () => {
    const html = `<!doctype html>
      <form id="f">
        <input id="name" />
        <button id="submit">Go</button>
        <input id="submitted" />
      </form>
      <script>
        document.getElementById('f').addEventListener('submit', (e) => {
          e.preventDefault();
          document.getElementById('submitted').value = 'yes';
        });
      </script>`;
    const page = await firstPage(stagehand);
    await page.goto(dataUrl(html), {
      waitUntil: "domcontentloaded",
      timeout: 15000,
    });

    await page.locator("#name").click();
    await page.type("foo");
    await page.keyPress("Enter");

    const submitted = await page.evaluate(
      () => (document.getElementById("submitted") as HTMLInputElement)?.value || "",
    );
    expect(submitted).toBe("yes");
  });

  it("Enter in textarea does not submit form (inserts newline)", async () => {
    const html = `<!doctype html>
      <form id="f">
        <textarea id="ta"></textarea>
        <button id="submit">Go</button>
        <input id="submitted" />
      </form>
      <script>
        document.getElementById('f').addEventListener('submit', (e) => {
          e.preventDefault();
          document.getElementById('submitted').value = 'yes';
        });
      </script>`;
    const page = await firstPage(stagehand);
    await page.goto(dataUrl(html), {
      waitUntil: "domcontentloaded",
      timeout: 15000,
    });

    await page.locator("#ta").click();
    await page.keyPress("a");
    await page.keyPress("Enter");
    await page.keyPress("b");

    const submitted = await page.evaluate(
      () => (document.getElementById("submitted") as HTMLInputElement)?.value || "",
    );
    const value = await page.evaluate(
      (sel) => (document.querySelector(sel) as HTMLTextAreaElement)!.value,
      "#ta",
    );
    expect(submitted).toBe("");
    expect(value).toBe("a\nb");
  });

  it('pressing "+" key types plus sign', async () => {
    const html = `<!doctype html>
      <input id="t" />`;
    const page = await firstPage(stagehand);
    await page.goto(dataUrl(html), {
      waitUntil: "domcontentloaded",
      timeout: 15000,
    });

    await page.locator("#t").click();
    await page.keyPress("+");
    const value = await page.evaluate(
      (sel) => (document.querySelector(sel) as HTMLInputElement)!.value,
      "#t",
    );
    expect(value).toBe("+");
  });

  it("invalid key chords do not leave modifier state stuck", async () => {
    const html = `<!doctype html>
      <input id="t" />`;
    const page = await firstPage(stagehand);
    await page.goto(dataUrl(html), {
      waitUntil: "domcontentloaded",
      timeout: 15000,
    });

    await page.locator("#t").click();
    await page.keyPress("Cmd+InvalidKey123");

    // Now try normal typing - should work if modifiers were cleared
    await page.type("ok");
    const value = await page.evaluate(
      (sel) => (document.querySelector(sel) as HTMLInputElement)!.value,
      "#t",
    );
    expect(value).toBe("ok");
  });
});

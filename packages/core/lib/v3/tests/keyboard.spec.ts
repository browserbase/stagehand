import { test, expect } from "@playwright/test";
import { V3 } from "../v3";
import { v3DynamicTestConfig } from "./v3.dynamic.config";

function dataUrl(html: string): string {
  return "data:text/html;charset=utf-8," + encodeURIComponent(html);
}

test.describe("V3 keyboard shortcuts and typing", () => {
  let v3: V3;

  test.beforeEach(async () => {
    v3 = new V3(v3DynamicTestConfig);
    await v3.init();
  });

  test.afterEach(async () => {
    await v3?.close?.().catch(() => {});
  });

  test("typing, select-all + delete clears input (Cmd maps cross-OS)", async () => {
    const html = `<!doctype html>
      <input id="i1" autofocus />`;
    const page = await v3.context.awaitActivePage();
    await page.goto(dataUrl(html), {
      waitUntil: "domcontentloaded",
      timeoutMs: 15000,
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

  test("accelerator does not inject printable text (Cmd+B does not type 'b')", async () => {
    const html = `<!doctype html>
      <input id="i" />`;
    const page = await v3.context.awaitActivePage();
    await page.goto(dataUrl(html), {
      waitUntil: "domcontentloaded",
      timeoutMs: 15000,
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

  test("Tab and Shift+Tab move focus", async () => {
    const html = `<!doctype html>
      <input id="a" />
      <input id="b" />`;
    const page = await v3.context.awaitActivePage();
    await page.goto(dataUrl(html), {
      waitUntil: "domcontentloaded",
      timeoutMs: 15000,
    });

    await page.locator("#a").click();
    await page.keyPress("Tab");
    const active1 = await page.evaluate(
      () => (document.activeElement as HTMLElement)?.id || "",
    );
    expect(active1).toBe("b");

    await page.keyPress("Shift+Tab");
    const active2 = await page.evaluate(
      () => (document.activeElement as HTMLElement)?.id || "",
    );
    expect(active2).toBe("a");
  });

  test("cut clears the field (Cmd+X)", async () => {
    const html = `<!doctype html>
      <input id="t" />`;
    const page = await v3.context.awaitActivePage();
    await page.goto(dataUrl(html), {
      waitUntil: "domcontentloaded",
      timeoutMs: 15000,
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

  test("single printable via keyPress types characters (a, Shift+A, space)", async () => {
    const html = `<!doctype html>
      <input id="t" autofocus />`;
    const page = await v3.context.awaitActivePage();
    await page.goto(dataUrl(html), {
      waitUntil: "domcontentloaded",
      timeoutMs: 15000,
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

  test("Backspace removes last char", async () => {
    const html = `<!doctype html>
      <input id="t" />`;
    const page = await v3.context.awaitActivePage();
    await page.goto(dataUrl(html), {
      waitUntil: "domcontentloaded",
      timeoutMs: 15000,
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

  test("Delete removes next char at caret", async () => {
    const html = `<!doctype html>
      <input id="t" />`;
    const page = await v3.context.awaitActivePage();
    await page.goto(dataUrl(html), {
      waitUntil: "domcontentloaded",
      timeoutMs: 15000,
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

  test("ArrowLeft moves caret and typing inserts in middle", async () => {
    const html = `<!doctype html>
      <input id="t" />`;
    const page = await v3.context.awaitActivePage();
    await page.goto(dataUrl(html), {
      waitUntil: "domcontentloaded",
      timeoutMs: 15000,
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

  test("Enter inserts newline in textarea", async () => {
    const html = `<!doctype html>
      <textarea id="ta"></textarea>`;
    const page = await v3.context.awaitActivePage();
    await page.goto(dataUrl(html), {
      waitUntil: "domcontentloaded",
      timeoutMs: 15000,
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

  test("Insert key (no-op for value)", async () => {
    const html = `<!doctype html>
      <input id="t" />`;
    const page = await v3.context.awaitActivePage();
    await page.goto(dataUrl(html), {
      waitUntil: "domcontentloaded",
      timeoutMs: 15000,
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

  test("Enter submits form from text input", async () => {
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
    const page = await v3.context.awaitActivePage();
    await page.goto(dataUrl(html), {
      waitUntil: "domcontentloaded",
      timeoutMs: 15000,
    });

    await page.locator("#name").click();
    await page.type("foo");
    await page.keyPress("Enter");

    const submitted = await page.evaluate(
      () =>
        (document.getElementById("submitted") as HTMLInputElement)?.value || "",
    );
    expect(submitted).toBe("yes");
  });

  test("Enter in textarea does not submit form (inserts newline)", async () => {
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
    const page = await v3.context.awaitActivePage();
    await page.goto(dataUrl(html), {
      waitUntil: "domcontentloaded",
      timeoutMs: 15000,
    });

    await page.locator("#ta").click();
    await page.keyPress("a");
    await page.keyPress("Enter");
    await page.keyPress("b");

    const submitted = await page.evaluate(
      () =>
        (document.getElementById("submitted") as HTMLInputElement)?.value || "",
    );
    const value = await page.evaluate(
      (sel) => (document.querySelector(sel) as HTMLTextAreaElement)!.value,
      "#ta",
    );
    expect(submitted).toBe("");
    expect(value).toBe("a\nb");
  });

  test('pressing "+" key types plus sign', async () => {
    const html = `<!doctype html>
      <input id="t" />`;
    const page = await v3.context.awaitActivePage();
    await page.goto(dataUrl(html), {
      waitUntil: "domcontentloaded",
      timeoutMs: 15000,
    });

    await page.locator("#t").click();
    await page.keyPress("+");
    const value = await page.evaluate(
      (sel) => (document.querySelector(sel) as HTMLInputElement)!.value,
      "#t",
    );
    expect(value).toBe("+");
  });

  test("modifier state clears on keyPress error", async () => {
    const html = `<!doctype html>
      <input id="t" />`;
    const page = await v3.context.awaitActivePage();
    await page.goto(dataUrl(html), {
      waitUntil: "domcontentloaded",
      timeoutMs: 15000,
    });

    await page.locator("#t").click();
    // Try invalid key that might throw
    try {
      await page.keyPress("Cmd+InvalidKey123");
    } catch {
      // Expected to fail
    }

    // Now try normal typing - should work if modifiers were cleared
    await page.type("ok");
    const value = await page.evaluate(
      (sel) => (document.querySelector(sel) as HTMLInputElement)!.value,
      "#t",
    );
    expect(value).toBe("ok");
  });
});

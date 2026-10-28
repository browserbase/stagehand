import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Stagehand } from "../../src/index.js";
import { closeStagehand, createStagehand, firstPage } from "./_support.js";

function dataUrl(html: string): string {
  return "data:text/html;charset=utf-8," + encodeURIComponent(html);
}

type KeyboardEventRecord = {
  type: string;
  key: string;
  code: string;
  keyCode: number;
  shiftKey: boolean;
  ctrlKey: boolean;
  repeat: boolean;
};

async function keyboardFixture(stagehand: Stagehand) {
  const page = await firstPage(stagehand);
  await page.goto(
    dataUrl(`<!doctype html>
      <input id="t" />
      <script>
        window.keyboardEvents = [];
        for (const type of ["keydown", "keyup"]) {
          document.addEventListener(type, (event) => {
            const { key, code, keyCode, shiftKey, ctrlKey, repeat } = event;
            window.keyboardEvents.push({ type, key, code, keyCode, shiftKey, ctrlKey, repeat });
          });
        }
      </script>`),
    { waitUntil: "domcontentloaded", timeout: 15000 },
  );
  await page.locator("#t").click();
  return page;
}

describe("v4 keyboard shortcuts and typing", () => {
  let stagehand: Stagehand;

  beforeEach(async () => {
    stagehand = await createStagehand();
  });

  afterEach(async () => {
    await closeStagehand(stagehand);
  });

  it("holds Shift across calls and reports key identity, repeat, and modifier release", async () => {
    const page = await keyboardFixture(stagehand);

    await page.keyDown("Shift");
    await page.keyDown("a");
    await page.keyDown("a");
    await page.keyUp("a");
    await page.keyUp("Shift");
    await page.keyPress("b");

    expect(await page.locator("#t").inputValue()).toBe("AAb");
    const events = await page.evaluate<KeyboardEventRecord[]>("window.keyboardEvents");
    expect(events).toMatchObject([
      { type: "keydown", key: "Shift", shiftKey: true, repeat: false },
      { type: "keydown", key: "A", code: "KeyA", keyCode: 65, shiftKey: true, repeat: false },
      { type: "keydown", key: "A", code: "KeyA", keyCode: 65, shiftKey: true, repeat: true },
      { type: "keyup", key: "A", code: "KeyA", keyCode: 65, shiftKey: true },
      { type: "keyup", key: "Shift", shiftKey: false },
      { type: "keydown", key: "b", code: "KeyB", keyCode: 66, shiftKey: false, repeat: false },
      { type: "keyup", key: "b", code: "KeyB", keyCode: 66, shiftKey: false },
    ]);
  });

  it("keyPress preserves a modifier already held by keyDown", async () => {
    const page = await keyboardFixture(stagehand);

    await page.keyDown("Shift");
    await page.keyPress("Shift+b");
    await page.keyPress("c");
    await page.keyUp("Shift");
    await page.keyPress("d");

    expect(await page.locator("#t").inputValue()).toBe("BCd");
    const events = await page.evaluate<KeyboardEventRecord[]>("window.keyboardEvents");
    expect(events.filter((event) => event.key === "Shift")).toMatchObject([
      { type: "keydown", shiftKey: true },
      { type: "keyup", shiftKey: false },
    ]);
  });

  it("held modifiers apply to page and locator clicks until released", async () => {
    const page = await firstPage(stagehand);
    await page.goto(
      dataUrl(`<!doctype html>
        <button id="target">Click</button>
        <script>
          window.clickModifiers = [];
          document.querySelector("button").addEventListener("click", (event) => {
            window.clickModifiers.push(event.shiftKey);
          });
        </script>`),
      { waitUntil: "domcontentloaded", timeout: 15000 },
    );
    const target = page.locator("#target");
    const { x, y } = await target.centroid();

    await page.keyDown("Shift");
    try {
      await page.click(x, y);
      await target.click();
    } finally {
      await page.keyUp("Shift");
    }
    await page.click(x, y);
    await target.click();

    expect(await page.evaluate<boolean[]>("window.clickModifiers")).toStrictEqual([
      true,
      true,
      false,
      false,
    ]);
  });

  it("held Control sends shortcuts without inserting printable text", async () => {
    const page = await keyboardFixture(stagehand);
    await page.locator("#t").fill("unchanged");

    await page.keyDown("Control");
    await page.keyDown("a");
    await page.keyUp("a");
    await page.keyUp("Control");

    expect(await page.locator("#t").inputValue()).toBe("unchanged");
    const events = await page.evaluate<KeyboardEventRecord[]>("window.keyboardEvents");
    expect(events).toMatchObject([
      { type: "keydown", key: "Control", ctrlKey: true },
      { type: "keydown", key: "a", code: "KeyA", keyCode: 65, ctrlKey: true },
      { type: "keyup", key: "a", code: "KeyA", keyCode: 65, ctrlKey: true },
      { type: "keyup", key: "Control", ctrlKey: false },
    ]);
  });

  it("punctuation uses its physical key rather than an editing-key character code", async () => {
    const page = await keyboardFixture(stagehand);
    await page.locator("#t").fill("ab");
    await page.evaluate(() => {
      const input = document.querySelector("input")!;
      input.setSelectionRange(1, 1);
    });

    await page.keyDown(".");
    await page.keyUp(".");

    expect(await page.locator("#t").inputValue()).toBe("a.b");
    const events = await page.evaluate<KeyboardEventRecord[]>("window.keyboardEvents");
    expect(events).toMatchObject([
      { type: "keydown", key: ".", code: "Period", keyCode: 190 },
      { type: "keyup", key: ".", code: "Period", keyCode: 190 },
    ]);
  });

  it("preserves literal line separators and Unicode in textarea input", async () => {
    const page = await firstPage(stagehand);
    await page.goto(dataUrl('<textarea id="t"></textarea>'));
    const textarea = page.locator("#t");

    for (const [key, value, caret] of [
      ["\n", "ab", 1], // Chrome ignores literal LF; CR produces a line break.
      ["\r", "a\nb", 2],
      ["\u2028", "a\u2028b", 2],
      ["\u2029", "a\u2029b", 2],
      ["😀", "a😀b", 3],
      ["ArrowLeft", "ab", 0],
    ] as const) {
      await textarea.fill("ab");
      await page.evaluate(() => {
        const input = document.querySelector("textarea")!;
        input.focus();
        input.setSelectionRange(1, 1);
      });
      await page.keyDown(key);
      await page.keyUp(key);
      expect(await textarea.inputValue()).toBe(value);
      expect(await page.evaluate(() => document.querySelector("textarea")!.selectionStart)).toBe(
        caret,
      );
    }
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

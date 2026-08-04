import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Stagehand } from "../../src/index.js";
import {
  closeStagehand,
  createStagehand,
  firstPage,
  startFixtureServer,
  type FixtureServer,
} from "./_support.js";
import type { Page } from "../../src/index.js";

async function setupTextarea(
  page: Page,
  fixtureUrl: string,
  options: { id: string; value?: string },
): Promise<void> {
  await page.goto(fixtureUrl, { waitUntil: "domcontentloaded" });
  await page.evaluate(({ id, value }) => {
    document.body.innerHTML = `<textarea id="${id}" style="width:400px;height:120px"></textarea>`;
    const el = document.getElementById(id) as HTMLTextAreaElement;
    el.value = value ?? "";
    el.focus();
  }, options);
}

async function textareaValue(page: Page, id: string): Promise<string> {
  return await page.evaluate(
    (selector) => (document.querySelector(selector) as HTMLTextAreaElement).value,
    `#${id}`,
  );
}

async function selectTextareaContents(page: Page, id: string): Promise<void> {
  await page.evaluate((selector) => {
    const el = document.querySelector(selector) as HTMLTextAreaElement;
    el.focus();
    el.setSelectionRange(0, el.value.length);
  }, `#${id}`);
}

async function setupCopyButton(
  page: Page,
  fixtureUrl: string,
  options: { id: string; text: string },
): Promise<void> {
  await page.goto(fixtureUrl, { waitUntil: "domcontentloaded" });
  await page.evaluate(({ id, text }) => {
    document.body.innerHTML = `<button id="${id}">Copy</button>`;
    const button = document.getElementById(id) as HTMLButtonElement;
    button.addEventListener("click", () => {
      void navigator.clipboard.writeText(text);
    });
  }, options);
}

describe("context.clipboard", () => {
  // Clipboard access requires document focus; run serially so parallel workers
  // don't race for it and fail with "Document is not focused".

  let stagehand: Stagehand;
  let fixture: FixtureServer;

  beforeEach(async () => {
    fixture = await startFixtureServer("<!doctype html><body></body>");
    stagehand = await createStagehand();
  });

  afterEach(async () => {
    await closeStagehand(stagehand);
    await fixture.close();
  });

  it("writeText() then readText()", async () => {
    const page = await firstPage(stagehand);
    await setupTextarea(page, fixture.url, { id: "target" });

    await stagehand.context.clipboard.writeText("hello");

    await expect(stagehand.context.clipboard.readText()).resolves.toBe("hello");
  });

  it("paste() inserts clipboard text into the focused textarea", async () => {
    const page = await firstPage(stagehand);
    await setupTextarea(page, fixture.url, { id: "target" });

    await stagehand.context.clipboard.writeText("hello");
    await stagehand.context.clipboard.paste();

    await expect(textareaValue(page, "target")).resolves.toBe("hello");
  });

  it("copy() copies selected textarea text", async () => {
    const page = await firstPage(stagehand);
    await setupTextarea(page, fixture.url, { id: "target", value: "copy me" });
    await selectTextareaContents(page, "target");

    await stagehand.context.clipboard.copy();

    await expect(stagehand.context.clipboard.readText()).resolves.toBe("copy me");
  });

  it("cut() cuts selected textarea text and updates clipboard", async () => {
    const page = await firstPage(stagehand);
    await setupTextarea(page, fixture.url, { id: "target", value: "cut me" });
    await selectTextareaContents(page, "target");

    await stagehand.context.clipboard.cut();

    await expect(stagehand.context.clipboard.readText()).resolves.toBe("cut me");
    await expect(textareaValue(page, "target")).resolves.toBe("");
  });

  it("a user-gesture copy event is readable via readText()", async () => {
    const page = await firstPage(stagehand);
    await setupCopyButton(page, fixture.url, {
      id: "copy-button",
      text: "Hello I'm some text",
    });

    // A real click provides the user activation Chrome requires to allow the
    // page's clipboard write; no permissions are pre-granted on the page.
    await page.locator("#copy-button").click();

    await expect.poll(() => stagehand.context.clipboard.readText()).toBe("Hello I'm some text");
  });

  it("defaults actions to the active page", async () => {
    const page1 = await firstPage(stagehand);
    await setupTextarea(page1, fixture.url, { id: "first" });

    const page2 = await stagehand.context.newPage();
    await setupTextarea(page2, fixture.url, { id: "second" });
    await stagehand.context.setActivePage(page2);

    await stagehand.context.clipboard.writeText("active page text");
    await stagehand.context.clipboard.paste();

    await expect(textareaValue(page1, "first")).resolves.toBe("");
    await expect(textareaValue(page2, "second")).resolves.toBe("active page text");
  });

  it("accepts an explicit page option for page-targeted actions", async () => {
    const page1 = await firstPage(stagehand);
    await setupTextarea(page1, fixture.url, { id: "first" });

    const page2 = await stagehand.context.newPage();
    await setupTextarea(page2, fixture.url, { id: "second" });

    await stagehand.context.clipboard.writeText("explicit page text", {
      page: page1,
    });
    await stagehand.context.setActivePage(page2);
    await stagehand.context.clipboard.paste({ page: page1 });

    await expect(textareaValue(page1, "first")).resolves.toBe("explicit page text");
    await expect(textareaValue(page2, "second")).resolves.toBe("");
  });
});

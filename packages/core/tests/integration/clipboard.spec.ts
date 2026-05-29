import { test, expect } from "@playwright/test";
import { V3 } from "../../lib/v3/v3.js";
import type { Page } from "../../lib/v3/types/public/page.js";
import { v3DynamicTestConfig } from "./v3.dynamic.config.js";
import { closeV3 } from "./testUtils.js";

const TEST_URL =
  "https://browserbase.github.io/stagehand-eval-sites/sites/example/";

async function setupTextarea(
  page: Page,
  options: { id: string; value?: string },
): Promise<void> {
  await page.goto(TEST_URL, {
    waitUntil: "domcontentloaded",
    timeoutMs: 15000,
  });
  await page.evaluate(({ id, value }) => {
    document.body.innerHTML = `<textarea id="${id}" style="width:400px;height:120px"></textarea>`;
    const el = document.getElementById(id) as HTMLTextAreaElement;
    el.value = value ?? "";
    el.focus();
  }, options);
}

async function textareaValue(page: Page, id: string): Promise<string> {
  return await page.evaluate(
    (selector) =>
      (document.querySelector(selector) as HTMLTextAreaElement).value,
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

test.describe("context.clipboard", () => {
  let v3: V3;

  test.beforeEach(async () => {
    v3 = new V3(v3DynamicTestConfig);
    await v3.init();
  });

  test.afterEach(async () => {
    await closeV3(v3);
  });

  test("writeText() then readText()", async () => {
    const page = await v3.context.awaitActivePage();
    await setupTextarea(page, { id: "target" });

    await v3.context.clipboard.writeText("hello");

    await expect(v3.context.clipboard.readText()).resolves.toBe("hello");
  });

  test("paste() inserts clipboard text into the focused textarea", async () => {
    const page = await v3.context.awaitActivePage();
    await setupTextarea(page, { id: "target" });

    await v3.context.clipboard.writeText("hello");
    await v3.context.clipboard.paste();

    await expect(textareaValue(page, "target")).resolves.toBe("hello");
  });

  test("copy() copies selected textarea text", async () => {
    const page = await v3.context.awaitActivePage();
    await setupTextarea(page, { id: "target", value: "copy me" });
    await selectTextareaContents(page, "target");

    await v3.context.clipboard.copy();

    await expect(v3.context.clipboard.readText()).resolves.toBe("copy me");
  });

  test("cut() cuts selected textarea text and updates clipboard", async () => {
    const page = await v3.context.awaitActivePage();
    await setupTextarea(page, { id: "target", value: "cut me" });
    await selectTextareaContents(page, "target");

    await v3.context.clipboard.cut();

    await expect(v3.context.clipboard.readText()).resolves.toBe("cut me");
    await expect(textareaValue(page, "target")).resolves.toBe("");
  });

  test("defaults actions to the active page", async () => {
    const page1 = await v3.context.awaitActivePage();
    await setupTextarea(page1, { id: "first" });

    const page2 = await v3.context.newPage();
    await setupTextarea(page2, { id: "second" });
    v3.context.setActivePage(page2);

    await v3.context.clipboard.writeText("active page text");
    await v3.context.clipboard.paste();

    await expect(textareaValue(page1, "first")).resolves.toBe("");
    await expect(textareaValue(page2, "second")).resolves.toBe(
      "active page text",
    );
  });

  test("accepts an explicit page option for page-targeted actions", async () => {
    const page1 = await v3.context.awaitActivePage();
    await setupTextarea(page1, { id: "first" });

    const page2 = await v3.context.newPage();
    await setupTextarea(page2, { id: "second" });

    await v3.context.clipboard.writeText("explicit page text", {
      page: page1,
    });
    v3.context.setActivePage(page2);
    await v3.context.clipboard.paste({ page: page1 });

    await expect(textareaValue(page1, "first")).resolves.toBe(
      "explicit page text",
    );
    await expect(textareaValue(page2, "second")).resolves.toBe("");
  });
});

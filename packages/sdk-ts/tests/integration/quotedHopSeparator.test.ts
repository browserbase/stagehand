import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Stagehand } from "../../src/index.js";
import { closeStagehand, createStagehand, firstPage } from "./_support.js";

describe("'>>' inside quoted selector values", () => {
  let stagehand: Stagehand;

  beforeEach(async () => {
    stagehand = await createStagehand();
  });

  afterEach(async () => {
    await closeStagehand(stagehand);
  });

  it("locator() matches a CSS attribute value that contains '>>'", async () => {
    const page = await firstPage(stagehand);
    await page.goto("data:text/html,<button aria-label='Next >>'>Next</button>");

    await expect(page.locator('button[aria-label="Next >>"]').count()).resolves.toBe(1);
  });

  it("waitForSelector() matches an XPath string literal that contains '>>'", async () => {
    const page = await firstPage(stagehand);
    await page.goto("data:text/html,<a href='/page/2'>Next >></a>");

    await expect(page.waitForSelector("//a[text()='Next >>']", { timeout: 2_000 })).resolves.toBe(
      true,
    );
  });
});

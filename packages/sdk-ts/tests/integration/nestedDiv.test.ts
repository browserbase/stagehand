import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Stagehand } from "../../src/index.js";
import { closeStagehand, createStagehand, firstPage } from "./_support.js";

describe("page.snapshot() handles deeply nested DOM trees", () => {
  let stagehand: Stagehand;

  beforeAll(async () => {
    stagehand = await createStagehand();
  });

  afterAll(async () => {
    await closeStagehand(stagehand);
  });

  it("does not throw for the nested-div regression page", async () => {
    const page = await firstPage(stagehand);
    await page.goto("https://browserbase.github.io/stagehand-eval-sites/sites/nested-div/");

    await expect(page.snapshot()).resolves.toBeDefined();
  });
});

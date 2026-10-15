import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Stagehand } from "../../src/index.js";
import {
  closeStagehand,
  createStagehand,
  firstPage,
  startFixtureServer,
  type FixtureServer,
} from "./_support.js";

describe("page.snapshot() with user-agent shadow DOM", () => {
  let fixture: FixtureServer;
  let stagehand: Stagehand;

  beforeAll(async () => {
    fixture = await startFixtureServer(
      '<!doctype html><body><label>Meeting <input type="datetime-local" /></label></body>',
    );
    stagehand = await createStagehand();
  });

  afterAll(async () => {
    await closeStagehand(stagehand);
    await fixture.close();
  });

  it("maps native date fields to their host input", async () => {
    const page = await firstPage(stagehand);
    await page.goto(fixture.url);

    const { formattedTree, xpathMap } = await page.snapshot();
    const fieldId = /\[([^\]]+)\] spinbutton/.exec(formattedTree)?.[1] ?? "";
    expect(xpathMap[fieldId]).toBe("/html[1]/body[1]/label[1]/input[1]");

    const input = page.locator(`xpath=${xpathMap[fieldId]}`);
    await input.fill("2025-07-23T10:00");
    expect(await input.inputValue()).toBe("2025-07-23T10:00");
  });
});

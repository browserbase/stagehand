import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Stagehand } from "../../src/index.js";
import {
  closeStagehand,
  createStagehand,
  firstPage,
  startFixtureServer,
  type FixtureServer,
} from "./_support.js";

describe("context.setExtraHTTPHeaders", () => {
  let fixture: FixtureServer;
  let stagehand: Stagehand;

  beforeEach(async () => {
    fixture = await startFixtureServer((request) => ({
      body: String(request.headers["x-stagehand-test"] ?? "missing"),
    }));
    stagehand = await createStagehand();
  });

  afterEach(async () => {
    await closeStagehand(stagehand);
    await fixture.close();
  });

  it("applies headers to navigation requests", async () => {
    await stagehand.context.setExtraHTTPHeaders({ "x-stagehand-test": "yes" });
    const page = await firstPage(stagehand);
    await page.goto(fixture.url);

    await expect(page.locator("body").innerText()).resolves.toBe("yes");
  });
});

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Stagehand } from "../../src/index.js";
import {
  closeStagehand,
  createStagehand,
  firstPage,
  startFixtureServer,
  type FixtureServer,
} from "./_support.js";

describe("page.setExtraHTTPHeaders", () => {
  let fixture: FixtureServer;
  let stagehand: Stagehand;

  beforeEach(async () => {
    fixture = await startFixtureServer((request) => ({
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request.headers),
    }));
    stagehand = await createStagehand();
  });

  afterEach(async () => {
    await closeStagehand(stagehand);
    await fixture.close();
  });

  it("applies headers to navigation requests", async () => {
    const page = await firstPage(stagehand);
    await page.setExtraHTTPHeaders({ "x-page-header": "from-page" });
    await page.goto(fixture.url);

    const headers = await page.evaluate<Record<string, string>>(() =>
      JSON.parse(document.body.innerText),
    );
    expect(headers["x-page-header"]).toBe("from-page");
  });

  it("updated headers replace previous ones", async () => {
    const page = await firstPage(stagehand);
    await page.setExtraHTTPHeaders({ "x-first": "yes" });
    await page.goto(fixture.url);
    await page.setExtraHTTPHeaders({ "x-second": "yes" });
    await page.goto(fixture.url);

    const headers = await page.evaluate<Record<string, string>>(() =>
      JSON.parse(document.body.innerText),
    );
    expect(headers["x-second"]).toBe("yes");
    expect(headers["x-first"]).toBeUndefined();
  });
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Stagehand } from "../../src/index.js";
import {
  closeStagehand,
  createStagehand,
  firstPage,
  startFixtureServer,
  type FixtureServer,
} from "./_support.js";

// A button-like <input> keeps its label in `value` and has no child nodes at all, so the
// text engine has to read the attribute to see it. Served over http because the locator
// scripts only run against a real page.
const FIXTURE = `<!doctype html>
<html>
  <body>
    <input id="publish" type="submit" value="Publish" />
    <input id="discard" type="reset" value="Discard" />
    <input id="preview" type="button" value="Preview" />
    <input id="typed" type="text" value="typed value" />
    <input id="image" type="image" value="Send" alt="Upload" />
    <button id="plain">Save</button>
  </body>
</html>`;

describe("text selectors against inputs that label themselves", () => {
  let fixtureServer: FixtureServer;
  let stagehand: Stagehand;

  beforeAll(async () => {
    fixtureServer = await startFixtureServer(FIXTURE);
    stagehand = await createStagehand();
  });

  afterAll(async () => {
    await closeStagehand(stagehand);
    await fixtureServer.close();
  });

  it("matches submit, reset and button inputs on their value", async () => {
    const page = await firstPage(stagehand);
    await page.goto(fixtureServer.url, { waitUntil: "load" });

    await expect.poll(() => page.locator("text=Publish").count()).toBe(1);
    await expect(page.locator("text=Discard").count()).resolves.toBe(1);
    await expect(page.locator("text=Preview").count()).resolves.toBe(1);

    // The match is the input itself, not some ancestor that happens to contain it.
    await expect(page.locator("text=Publish").first().inputValue()).resolves.toBe("Publish");
  });

  it("leaves the value of other inputs alone", async () => {
    const page = await firstPage(stagehand);
    await page.goto(fixtureServer.url, { waitUntil: "load" });

    // A typed-in value is data, not a label, and an image button is not labelled by either
    // its value or its alt text.
    await expect.poll(() => page.locator("text=typed value").count()).toBe(0);
    await expect(page.locator("text=Send").count()).resolves.toBe(0);
    await expect(page.locator("text=Upload").count()).resolves.toBe(0);

    // Control: elements that carry their text as child nodes keep matching as before.
    await expect(page.locator("text=Save").count()).resolves.toBe(1);
  });
});

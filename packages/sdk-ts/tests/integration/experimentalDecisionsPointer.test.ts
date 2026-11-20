import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Stagehand } from "../../src/index.js";
import { closeStagehand, createStagehand, firstPage } from "./_support.js";

describe("experimentalDecisions pointer dispatch", () => {
  let stagehand: Stagehand;

  beforeAll(async () => {
    stagehand = await createStagehand({ experimentalDecisions: { apiKey: "fixture" } });
  });
  afterAll(() => closeStagehand(stagehand));

  it.each([
    ["click", "click"],
    ["doubleClick", "dblclick"],
    ["hover", "mousemove"],
  ] as const)("checks the content-quad centroid before %s", async (method, expectedEvent) => {
    const page = await firstPage(stagehand);
    for (const coverContent of [true, false]) {
      // The content center is x=190 and the border-box center is x=130.
      const html = `
          <style>
            #target { position: fixed; left: 50px; top: 80px; box-sizing: content-box;
                      width: 40px; height: 24px; padding: 0 0 0 120px; border: 0; }
            #cover { position: fixed; top: 80px; left: ${coverContent ? 182 : 122}px;
                     width: 16px; height: 24px; }
          </style>
          <button id="target">Buy</button><div id="cover"></div>
        `;
      await page.goto(`data:text/html,${encodeURIComponent(html)}`);
      await page.evaluate(() => {
        for (const type of ["mousemove", "pointerdown", "click", "dblclick"])
          document.addEventListener(type, (event) => {
            const recipient = (event.target as Element).id;
            document.body.dataset.events =
              (document.body.dataset.events ?? "") + `${type}/${recipient}/${event.isTrusted} `;
          });
      });
      const { data } = await stagehand.experimentalDecisions.act(
        { method, selector: "#target", arguments: [], description: "Buy" },
        { page },
      );
      expect(data.success).toBe(!coverContent);
      const events = await page.evaluate(() => document.body.dataset.events ?? "");
      if (coverContent) expect(events).toBe("");
      else {
        expect(events).toContain(`${expectedEvent}/target/true`);
        expect(events).not.toContain("/cover/");
      }
    }
  });
});

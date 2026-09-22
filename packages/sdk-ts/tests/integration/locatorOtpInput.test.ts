import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Stagehand } from "../../src/index.js";
import { closeStagehand, createStagehand, firstPage } from "./_support.js";

describe("auto-advancing code inputs", () => {
  let stagehand: Stagehand;

  beforeEach(async () => {
    stagehand = await createStagehand();
  });

  afterEach(async () => {
    await closeStagehand(stagehand);
  });

  for (const method of ["fill", "type"] as const) {
    it(`${method} follows focus after each digit`, async () => {
      const page = await firstPage(stagehand);
      await page.goto(
        "data:text/html," +
          encodeURIComponent(`
            <input id="digit-0" maxlength="1"><input id="digit-1" maxlength="1">
            <input id="digit-2" maxlength="1"><input id="digit-3" maxlength="1">
            <script>
              const inputs = [...document.querySelectorAll('input')];
              inputs.forEach((input, index) => input.addEventListener('input', () => {
                if (input.value) inputs[index + 1]?.focus();
              }));
            </script>`),
      );

      await page.locator("#digit-0")[method]("1234");

      expect(
        await page.evaluate(() =>
          [...document.querySelectorAll("input")].map((input) => input.value),
        ),
      ).toEqual(["1", "2", "3", "4"]);
    });
  }
});

import { dropdownFixture, resistorFixture } from "../../fixtures/index.js";
import { defineCoreTask } from "../../../framework/defineTask.js";

export default defineCoreTask(
  { name: "back_forward" },
  async ({ page, assert, metrics }) => {
    await page.goto(dropdownFixture.url);
    const firstUrl = page.url();
    assert.includes(firstUrl, "dropdown");

    await page.goto(resistorFixture.url);
    const secondUrl = page.url();
    assert.includes(secondUrl, "resistor");

    const stopBack = metrics.startTimer("goBack_ms");
    await page.back();
    stopBack();
    assert.includes(page.url(), "dropdown");

    const stopForward = metrics.startTimer("goForward_ms");
    await page.forward();
    stopForward();
    assert.includes(page.url(), "resistor");
  },
);

import { dropdownFixture } from "../../fixtures/index.js";
import { defineCoreTask } from "../../../framework/defineTask.js";

export default defineCoreTask({ name: "click" }, async ({ page, assert, metrics }) => {
  await page.goto(dropdownFixture.url);
  const button = page.locator("xpath=/html/body/div/div/button");
  assert.truthy(await button.count(), "Dropdown button should exist");

  const stop = metrics.startTimer("click_ms");
  await button.click();
  stop();

  await page.waitForTimeout(200);
  const options = page.locator("xpath=/html/body/div/div/ul");
  const isVisible = await options.isVisible();
  assert.truthy(isVisible, "Dropdown options should be visible after click");
});

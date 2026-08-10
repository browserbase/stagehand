import { dropdownFixture } from "../../fixtures/index.js";
import { defineCoreTask } from "../../../framework/defineTask.js";

export default defineCoreTask(
  { name: "get_url" },
  async ({ page, assert, metrics }) => {
    await page.goto(dropdownFixture.url);

    const stop = metrics.startTimer("url_ms");
    const url = page.url();
    stop();

    assert.includes(url, "dropdown");
    assert.matches(
      url,
      /^(data:text\/html|http:\/\/127\.0\.0\.1:|http:\/\/localhost:|https:\/\/browserbase\.github\.io\/stagehand-eval-sites\/)/,
    );
  },
);

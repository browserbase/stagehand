import { defineBenchV4Task } from "../../../framework/defineTask.js";

export default defineBenchV4Task(
  { name: "iframe_same_proc" },
  async ({ debugUrl, sessionUrl, stagehand, page, logger }) => {
    try {
      await page.goto(
        "https://browserbase.github.io/stagehand-eval-sites/sites/iframe-same-proc/",
      );

      await stagehand.act("type 'stagehand' into the 'your name' field");

      // overly specific prompting is okay here. we are just trying to evaluate whether
      // we are properly traversing iframes
      await stagehand.act(
        "select 'Green' from the favorite colour dropdown. Ensure the word 'Green' is capitalized. Choose the selectOption method.",
      );

      // v3 used page.frameLocator("iframe") for these assertions; v4 has no
      // frameLocator, so the same checks are re-expressed in-page via the
      // same-origin iframe's contentDocument.
      const { nameValue, colorValue } = await page.evaluate(() => {
        const doc = document.querySelector("iframe")?.contentDocument;
        if (!doc) throw new Error("could not access iframe contentDocument");

        const name = doc.querySelector(
          'input[placeholder="Alice"]',
        ) as HTMLInputElement | null;
        const color = doc.querySelector("select") as HTMLSelectElement | null;

        if (!name || !color) {
          throw new Error("could not resolve form fields inside the iframe");
        }

        return {
          nameValue: name.value,
          colorValue: color.value,
        };
      });

      const passed: boolean =
        nameValue.toLowerCase().trim() === "stagehand" &&
        colorValue.toLowerCase().trim() === "green";

      return {
        _success: passed,
        logs: logger.getLogs(),
        debugUrl,
        sessionUrl,
      };
    } catch (error) {
      return {
        _success: false,
        error: error,
        logs: logger.getLogs(),
        debugUrl,
        sessionUrl,
      };
    } finally {
      await stagehand.close();
    }
  },
);

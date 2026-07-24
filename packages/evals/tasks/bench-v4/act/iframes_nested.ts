import { defineBenchV4Task } from "../../../framework/defineTask.js";

export default defineBenchV4Task(
  { name: "iframes_nested" },
  async ({ debugUrl, sessionUrl, stagehand, page, logger }) => {
    try {
      await page.goto(
        "https://browserbase.github.io/stagehand-eval-sites/sites/nested-iframes/",
      );

      await stagehand.act("type 'stagehand' into the 'username' field");

      // v3 chained frameLocator lvl1 -> lvl2 -> lvl3 (form lives in level 3);
      // v4 has no frameLocator, so the same check is re-expressed in-page by
      // walking the same-origin iframes' contentDocuments.
      const usernameText = await page.evaluate(() => {
        const lvl1 = (
          document.querySelector("iframe.lvl1") as HTMLIFrameElement | null
        )?.contentDocument; // level 1
        const lvl2 = (
          lvl1?.querySelector("iframe.lvl2") as HTMLIFrameElement | null
        )?.contentDocument; // level 2
        const lvl3 = (
          lvl2?.querySelector("iframe.lvl3") as HTMLIFrameElement | null
        )?.contentDocument; // level 3 – form lives here

        const input = lvl3?.querySelector(
          'input[name="username"]',
        ) as HTMLInputElement | null;
        if (!input) {
          throw new Error(
            "could not resolve the username input in the nested iframes",
          );
        }
        return input.value;
      });

      const passed: boolean = usernameText.toLowerCase().trim() === "stagehand";

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

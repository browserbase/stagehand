import { defineBenchTask } from "../../../framework/defineTask.js";

export default defineBenchTask(
  { name: "iframes_nested" },
  async ({ debugUrl, sessionUrl, stagehand, page, logger }) => {
    try {
      await page.goto("https://stagehand-eval-sites.vercel.app/sites/nested-iframes/");

      await stagehand.act("type 'stagehand' into the 'username' field");

      const usernameText = await page.evaluate(() => {
        const lvl1 = (document.querySelector("iframe.lvl1") as HTMLIFrameElement | null)
          ?.contentDocument;
        const lvl2 = (lvl1?.querySelector("iframe.lvl2") as HTMLIFrameElement | null)
          ?.contentDocument;
        const lvl3 = (lvl2?.querySelector("iframe.lvl3") as HTMLIFrameElement | null)
          ?.contentDocument;

        const input = lvl3?.querySelector('input[name="username"]') as HTMLInputElement | null;
        if (!input) {
          throw new Error("could not resolve the username input in the nested iframes");
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
        error: error instanceof Error ? error.message : String(error),
        logs: logger.getLogs(),
        debugUrl,
        sessionUrl,
      };
    }
  },
);

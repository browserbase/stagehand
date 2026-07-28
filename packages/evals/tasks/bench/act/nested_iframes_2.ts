import { defineBenchTask } from "../../../framework/defineTask.js";

export default defineBenchTask(
  { name: "nested_iframes_2" },
  async ({ debugUrl, sessionUrl, stagehand, page, logger }) => {
    try {
      await page.goto("https://browserbase.github.io/stagehand-eval-sites/sites/nested-iframes-2/");

      await stagehand.act("click the button called 'click me (inner 2)'");

      // The target button lives in a nested same-origin iframe.
      const messageText = await page.evaluate(() => {
        const outer = (
          document.querySelector('iframe[src="iframe2.html"]') as HTMLIFrameElement | null
        )?.contentDocument;
        const inner = (
          outer?.querySelector('iframe[src="inner2.html"]') as HTMLIFrameElement | null
        )?.contentDocument;

        const msg = inner?.querySelector("#msg");
        if (!msg) {
          throw new Error("could not resolve #msg in the nested iframes");
        }
        return msg.textContent ?? "";
      });

      const passed: boolean =
        messageText.toLowerCase().trim() === "clicked the button in the second inner iframe";

      return {
        _success: passed,
        logs: logger.getLogs(),
        debugUrl,
        sessionUrl,
      };
    } catch (error) {
      return {
        _success: false,
        logs: logger.getLogs(),
        debugUrl,
        sessionUrl,
        error: String(error),
      };
    } finally {
      await stagehand.close();
    }
  },
);

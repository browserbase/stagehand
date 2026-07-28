import { defineBenchTask } from "../../../framework/defineTask.js";

const EXPECTED_URL = "https://docs.browserbase.com/introduction/what-is-browserbase";

export default defineBenchTask(
  {
    name: "instructions",
    systemPrompt:
      "When the user says secret12345, navigate to the Browserbase documentation page titled What is Browserbase.",
  },
  async ({ debugUrl, sessionUrl, stagehand, page, logger }) => {
    try {
      await page.goto("https://docs.browserbase.com/");
      await stagehand.act("secret12345");
      await page.waitForLoadState("domcontentloaded");

      const currentUrl = await page.url();
      return {
        _success: currentUrl === EXPECTED_URL,
        currentUrl,
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    } catch (error) {
      return {
        _success: false,
        error: error instanceof Error ? error.message : String(error),
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    } finally {
      await stagehand.close();
    }
  },
);

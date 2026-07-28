import { defineBenchTask } from "../../../framework/defineTask.js";

export default defineBenchTask(
  { name: "heal_simple_google_search" },
  async ({ debugUrl, sessionUrl, stagehand, page, logger }) => {
    try {
      await page.goto("https://browserbase.github.io/stagehand-eval-sites/sites/google/");

      await stagehand.act({
        description: "The search bar",
        selector: "/html/not-the-search-bar",
        arguments: ["OpenAI"],
        method: "fill",
      });
      await stagehand.act("press enter");
      await new Promise((resolve) => setTimeout(resolve, 3000));

      const expectedUrl =
        "https://browserbase.github.io/stagehand-eval-sites/sites/google/openai.html";
      const currentUrl = await page.url();

      return {
        _success: currentUrl.startsWith(expectedUrl),
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

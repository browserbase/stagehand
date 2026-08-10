import { defineBenchTask } from "../../../framework/defineTask.js";

export default defineBenchTask(
  { name: "heal_simple_google_search" },
  async ({ debugUrl, sessionUrl, v3, logger }) => {
    try {
      const page = v3.context.pages()[0];
      await page.goto(
        "https://browserbase.github.io/stagehand-eval-sites/sites/google/",
      );

      await v3.act({
        description: "The search bar",
        selector: "/html/not-the-search-bar",
        arguments: ["OpenAI"],
        method: "fill",
      });

      await v3.act("press enter");
      await new Promise((resolve) => setTimeout(resolve, 3000));

      const expectedUrl =
        "https://browserbase.github.io/stagehand-eval-sites/sites/google/openai.html";
      const currentUrl = page.url();

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
        error: error,
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    } finally {
      await v3.close();
    }
  },
);

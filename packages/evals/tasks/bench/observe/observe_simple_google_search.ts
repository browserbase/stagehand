import { defineBenchV4Task } from "../../../framework/defineTask.js";

export default defineBenchV4Task(
  { name: "observe_simple_google_search" },
  async ({ debugUrl, sessionUrl, stagehand, page, logger }) => {
    try {
      await page.goto("https://browserbase.github.io/stagehand-eval-sites/sites/google/");
      const { data: observation1 } = await stagehand.observe(
        "Find the search bar and type 'OpenAI'",
      );

      if (observation1.length > 0) {
        const action1 = observation1[0];
        await stagehand.act(action1);
      }
      const { data: observation2 } = await stagehand.observe("Press enter");

      if (observation2.length > 0) {
        const action2 = observation2[0];
        await stagehand.act(action2);
      }
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

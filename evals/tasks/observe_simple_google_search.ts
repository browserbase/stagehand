import { EvalFunction } from "@/types/evals";
import { performPlaywrightMethod } from "@/lib/a11y/utils";

export const observe_simple_google_search: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  stagehand,
  logger,
}) => {
  await stagehand.page.goto(
    "https://browserbase.github.io/stagehand-eval-sites/sites/google/",
  );

  try {
    const observation1 = await stagehand.page.observe({
      instruction: "Find the search bar and type 'OpenAI'",
    });

    if (observation1.length > 0) {
      const action1 = observation1[0];
      await performPlaywrightMethod(
        stagehand.page,
        stagehand.logger,
        action1.method,
        action1.arguments,
        action1.selector.replace("xpath=", ""),
      );
    }
    const observation2 = await stagehand.page.observe({
      instruction: "Click the search button in the suggestions dropdown",
    });

    if (observation2.length > 0) {
      const action2 = observation2[0];
      await performPlaywrightMethod(
        stagehand.page,
        stagehand.logger,
        action2.method,
        action2.arguments,
        action2.selector.replace("xpath=", ""),
      );
    }

    const expectedUrl =
      "https://browserbase.github.io/stagehand-eval-sites/sites/google/openai.html";
    const currentUrl = stagehand.page.url();

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
    await stagehand.close();
  }
};

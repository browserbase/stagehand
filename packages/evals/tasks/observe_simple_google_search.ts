import { EvalFunction } from "../types/evals";

export const observe_simple_google_search: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  v3,
  logger,
}) => {
  try {
    const page = v3.context.pages()[0];
    await page.goto(
      "https://browserbase.github.io/stagehand-eval-sites/sites/google/",
    );
    const observation1 = await v3.observe(
      "Find the search bar and type 'OpenAI'",
    );

    if (observation1.length > 0) {
      const action1 = observation1[0];
      await v3.act(action1);
    }
    const observation2 = await v3.observe(
      "Click the search button in the suggestions dropdown",
    );

    if (observation2.length > 0) {
      const action2 = observation2[0];
      await v3.act(action2);
    }

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
};

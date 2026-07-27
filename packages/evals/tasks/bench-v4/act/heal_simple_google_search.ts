import { defineBenchV4Task } from "../../../framework/defineTask.js";

export default defineBenchV4Task(
  { name: "heal_simple_google_search" },
  async ({ debugUrl, sessionUrl, stagehand, page, logger }) => {
    try {
      await page.goto(
        "https://browserbase.github.io/stagehand-eval-sites/sites/google/",
      );

      // V4 GAP (V4_API_LOGS.md #1): this eval exercises v3's self-healing
      // act(observeResult) path — v3 was given a "fill" action with
      // arguments ["OpenAI"] on an intentionally invalid selector
      // ("/html/not-the-search-bar") and expected to heal by re-locating
      // "The search bar" and filling it, then pressing enter. v4's
      // stagehand.act accepts a string only, and the replayObservedAction
      // workaround replays via locators with no healing, so the behavior
      // under test cannot be exercised on v4. Fail loudly rather than
      // silently substitute a different behavior. (v3 success criterion:
      // after the healed fill and "press enter", the URL starts with
      // https://browserbase.github.io/stagehand-eval-sites/sites/google/openai.html)
      throw new Error(
        "V4 GAP: v4 has no act(observeResult) self-healing replay (stagehand.act accepts a string only — V4_API_LOGS.md #1); heal_simple_google_search cannot run on v4",
      );
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
  },
);

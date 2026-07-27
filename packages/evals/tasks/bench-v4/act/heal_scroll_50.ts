import { defineBenchV4Task } from "../../../framework/defineTask.js";

export default defineBenchV4Task(
  { name: "heal_scroll_50" },
  async ({ debugUrl, sessionUrl, stagehand, page, logger }) => {
    try {
      await page.goto(
        "https://browserbase.github.io/stagehand-eval-sites/sites/aigrant/",
      );

      // V4 GAP (V4_API_LOGS.md #1): this eval exercises v3's self-healing
      // act(observeResult) path — v3 was given a "scrollTo" action with
      // arguments ["50%"] on selector "/html/body/div/div/button" and
      // expected to heal and scroll halfway down the page. v4's
      // stagehand.act accepts a string only, and the replayObservedAction
      // workaround replays via locators with no healing (and does not
      // support the "scrollTo" method), so the behavior under test cannot
      // be exercised on v4. Fail loudly rather than silently substitute a
      // different behavior. (v3 success criterion: scroll position within
      // 200px of halfway down the page after a 5s wait.)
      throw new Error(
        "V4 GAP: v4 has no act(observeResult) self-healing replay (stagehand.act accepts a string only — V4_API_LOGS.md #1); heal_scroll_50 cannot run on v4",
      );
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

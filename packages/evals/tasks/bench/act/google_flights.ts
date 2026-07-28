import { defineBenchV4Task } from "../../../framework/defineTask.js";

/**
 * This eval attempts to click on an element that should not pass the playwright actionability check
 * which happens by default if you call locator.click (more information here:
 * https://playwright.dev/docs/actionability)
 *
 * In v3, passing this eval means performPlaywrightMethod correctly set {force: true}, so the click
 * succeeded even though the target element (found by the xpath) did not pass the actionability
 * check.
 */

export default defineBenchV4Task(
  { name: "google_flights" },
  async ({ debugUrl, sessionUrl, stagehand, page, logger }) => {
    try {
      await page.goto("https://browserbase.github.io/stagehand-eval-sites/sites/google-flights/");

      // V4 GAP: this eval exercises v3's force-click behavior — v3's
      // act(observeResult) replay clicked selector
      // "xpath=/html/body/c-wiz[2]/.../ul/li[1]/div/div[1]" ("the first
      // departing flight") with {force: true}, bypassing the playwright
      // actionability check. v4 has no act(observeResult) replay
      //, and v4's Locator.click exposes no force option
      // (packages/sdk-ts/src/locator.ts), so the behavior under test cannot
      // be exercised on v4. Fail loudly rather than silently substitute a
      // non-forced click. (v3 success criterion: navigation to
      // return-flight.html after the forced click.)
      throw new Error(
        "V4 GAP: v4 locator.click has no force option (packages/sdk-ts/src/locator.ts) and no act(observeResult) replay; google_flights cannot run on v4",
      );
    } catch (error) {
      return {
        _success: false,
        error: error instanceof Error ? error.message : String(error),
        logs: logger.getLogs(),
        debugUrl,
        sessionUrl,
      };
    } finally {
      await stagehand.close();
    }
  },
);

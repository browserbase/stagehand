import type { Page } from "@browserbasehq/stagehand-v4-spike-sdk-ts";
import { defineBenchV4Task } from "../../../framework/defineTask.js";

/** The v4 SDK does not export the observe result type (V4_API_LOGS.md #7). */
type ObservedAction = Awaited<ReturnType<Page["observe"]>>[number];

/**
 * WORKAROUND (V4_API_LOGS.md #1): v4 has no `act(observeResult)` replay.
 * This mirrors what v3's act(ObserveResult) does internally (resolve the
 * selector, invoke the planned method) so the task's observe→act flow and
 * success criterion stay identical. This is consumer-side code the SDK
 * should own.
 */
async function replayObservedAction(
  page: Page,
  action: ObservedAction,
): Promise<void> {
  const locator = page.locator(action.selector);
  const method = action.method ?? "click";
  const args = action.arguments ?? [];
  switch (method) {
    case "click":
      await locator.click();
      return;
    case "fill":
      await locator.fill(args[0] ?? "");
      return;
    case "type":
      await locator.type(args[0] ?? "");
      return;
    case "press":
      await page.keyPress(args[0] ?? "");
      return;
    case "selectOption":
    case "selectOptionFromDropdown":
      await locator.selectOption(args);
      return;
    default:
      throw new Error(
        `replayObservedAction: unsupported observed method "${method}"`,
      );
  }
}

export default defineBenchV4Task(
  { name: "observe_simple_google_search" },
  async ({ debugUrl, sessionUrl, stagehand, page, logger }) => {
    try {
      await page.goto(
        "https://browserbase.github.io/stagehand-eval-sites/sites/google/",
      );
      const observation1 = await page.observe(
        "Find the search bar and type 'OpenAI'",
      );

      if (observation1.length > 0) {
        const action1 = observation1[0];
        await replayObservedAction(page, action1);
      }
      const observation2 = await page.observe("Press enter");

      if (observation2.length > 0) {
        const action2 = observation2[0];
        await replayObservedAction(page, action2);
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

/**
 * observe→act replay for v4 bench tasks.
 *
 * WORKAROUND (V4_API_LOGS.md #1): v4 has no `act(observeResult)` replay.
 * Mirrors what v3's act(ObserveResult) does internally (resolve the
 * selector, invoke the planned method) so observe→act task flows and
 * success criteria stay identical. Consumer-side code the SDK should own —
 * delete this when v4 implements `ReplayActionSchema`.
 *
 * Ported 1:1 from the v4-spike self-contained eval tree
 * (packages/sdk-ts/evals/framework.ts) so tasks adapted from that tree keep
 * identical replay semantics.
 */
import type { Page, Stagehand } from "@browserbasehq/stagehand-v4-spike-sdk-ts";

export type ObservedAction = Awaited<ReturnType<Stagehand["observe"]>>[number];

export async function replayObservedAction(
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

import { EvalFunction } from "../types/evals";

export const observe_iframes1: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  v3,
  logger,
}) => {
  try {
    const page = v3.context.pages()[0];
    await page.goto(
      "https://browserbase.github.io/stagehand-eval-sites/sites/iframe-hn/",
    );

    const observations = await v3.observe("find the main header of the page");

    if (observations.length === 0) {
      return {
        _success: false,
        observations,
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    }

    const possibleLocators = [
      `body > main > section.iframe-wrapper > iframe`,
      `body > header > h1`,
    ];

    // Precompute candidate backendNodeIds
    const candidateIds = new Map<string, number>();
    for (const sel of possibleLocators) {
      try {
        const id = await page.locator(sel).backendNodeId();
        candidateIds.set(sel, id);
      } catch {
        // ignore candidates that fail to resolve
      }
    }

    let foundMatch = false;
    let matchedLocator: string | null = null;

    for (const observation of observations) {
      try {
        const obsId = await page.locator(observation.selector).backendNodeId();
        for (const [candSel, candId] of candidateIds) {
          if (candId === obsId) {
            foundMatch = true;
            matchedLocator = candSel;
            break;
          }
        }
        if (foundMatch) break;
      } catch (error) {
        console.warn(
          `Failed to check observation with selector ${observation.selector}:`,
          error?.message ?? String(error),
        );
        continue;
      }
    }

    return {
      _success: foundMatch,
      matchedLocator,
      observations,
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

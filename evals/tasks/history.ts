import { EvalFunction } from "@/types/evals";

export const history: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  stagehand,
  logger,
}) => {
  try {
    await stagehand.page.goto("https://docs.stagehand.dev");
    await stagehand.page.act("click on the 'Quickstart' tab");
    await stagehand.page.extract("Extract the title of the page");
    await stagehand.page.observe("Find all links on the page");

    const history = stagehand.history;

    const hasCorrectNumberOfEntries = history.length === 4;

    const hasNavigateEntry = history[0].method === "navigate";
    const hasActEntry = history[1].method === "act";
    const hasExtractEntry = history[2].method === "extract";
    const hasObserveEntry = history[3].method === "observe";

    const allEntriesHaveTimestamps = history.every(
      (entry) =>
        typeof entry.timestamp === "string" && entry.timestamp.length > 0,
    );
    const allEntriesHaveResults = history.every(
      (entry) => entry.result !== undefined,
    );

    const success =
      hasCorrectNumberOfEntries &&
      hasNavigateEntry &&
      hasActEntry &&
      hasExtractEntry &&
      hasObserveEntry &&
      allEntriesHaveTimestamps &&
      allEntriesHaveResults;

    return {
      _success: success,
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

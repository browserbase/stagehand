const STAGEHAND_CONTENT_SCRIPT_FILE = "content-script.js";
// Chrome refuses other top-level schemes (about:blank, chrome://), which would only add noise to onError.
const SCRIPTABLE_TAB_URL = /^(?:https?|file):/u;

type Tab = {
  id?: number;
  discarded?: boolean;
  url?: string;
};

export type ContentScriptInjectionChrome = {
  scripting: {
    executeScript(injection: {
      target: { tabId: number; allFrames: true };
      files: [string];
      world: "ISOLATED";
    }): Promise<unknown>;
  };
  tabs: {
    query(queryInfo: Record<string, never>): Promise<Tab[]>;
  };
};

// Chrome adds manifest content scripts only to documents created after the extension loaded.
export async function injectContentScriptIntoOpenTabs(
  chromeApi: ContentScriptInjectionChrome,
  onError: (error: unknown) => void = (error) =>
    // oxlint-disable-next-line no-console -- The worker has no other channel before a client attaches.
    console.error("Stagehand content script injection failed", error),
): Promise<void> {
  try {
    const tabs = await chromeApi.tabs.query({});
    const results = await Promise.allSettled(
      tabs.flatMap((tab) =>
        tab.id === undefined || tab.discarded || !SCRIPTABLE_TAB_URL.test(tab.url ?? "")
          ? []
          : [
              chromeApi.scripting.executeScript({
                target: { tabId: tab.id, allFrames: true },
                files: [STAGEHAND_CONTENT_SCRIPT_FILE],
                world: "ISOLATED",
              }),
            ],
      ),
    );
    for (const result of results) if (result.status === "rejected") onError(result.reason);
  } catch (error) {
    onError(error);
  }
}

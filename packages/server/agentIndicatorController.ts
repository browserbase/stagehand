const AGENT_INDICATOR_CSS = `
:root::after {
  content: "" !important;
  position: fixed !important;
  inset: 0 !important;
  z-index: 2147483647 !important;
  display: block !important;
  box-sizing: border-box !important;
  pointer-events: none !important;
  user-select: none !important;
  border: 2px solid rgba(255, 157, 91, .82) !important;
  box-shadow:
    inset 0 0 3px rgba(255, 235, 209, .94),
    inset 0 0 12px rgba(255, 198, 114, .72),
    inset 0 0 34px rgba(255, 69, 0, .36) !important;
}
`;

type AgentIndicatorCssInjection = {
  target: { tabId: number };
  css: string;
  origin: "USER";
};

type ChromeEvent<Listener extends (...args: never[]) => unknown> = {
  addListener(listener: Listener): void;
};

export type AgentIndicatorChrome = {
  scripting: {
    insertCSS(injection: AgentIndicatorCssInjection): Promise<void>;
    removeCSS(injection: AgentIndicatorCssInjection): Promise<void>;
  };
  tabs: {
    query(queryInfo: Record<string, never>): Promise<Array<{ id?: number }>>;
    onUpdated: ChromeEvent<(tabId: number, changeInfo: { status?: string }, tab: unknown) => void>;
  };
};

export type AgentIndicatorController = {
  setActive(active: boolean): Promise<void>;
};

/** Owns the session indicator's state, tab fan-out, and navigation reapplication. */
export function createAgentIndicatorController(
  chromeApi: AgentIndicatorChrome,
): AgentIndicatorController {
  let desiredActive = false;
  let transition = Promise.resolve();
  const styledTabs = new Set<number>();

  const injectionFor = (tabId: number): AgentIndicatorCssInjection => ({
    target: { tabId },
    css: AGENT_INDICATOR_CSS,
    origin: "USER",
  });

  const applyToTab = async (tabId: number, active: boolean): Promise<void> => {
    try {
      const injection = injectionFor(tabId);
      if (active) {
        await chromeApi.scripting.insertCSS(injection);
        styledTabs.add(tabId);
      } else {
        await chromeApi.scripting.removeCSS(injection);
        styledTabs.delete(tabId);
      }
    } catch {
      // Restricted pages and tabs that disappear during fan-out are expected.
      styledTabs.delete(tabId);
    }
  };

  const enqueue = (operation: () => Promise<void>): Promise<void> => {
    transition = transition.catch(() => {}).then(operation);
    return transition;
  };

  const applyToAllTabs = async (active: boolean): Promise<void> => {
    const tabs = await chromeApi.tabs.query({});
    if (desiredActive !== active) return;
    await Promise.all(
      tabs.flatMap((tab) =>
        tab.id === undefined || (active && styledTabs.has(tab.id))
          ? []
          : [applyToTab(tab.id, active)],
      ),
    );
  };

  chromeApi.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === "loading") styledTabs.delete(tabId);
    if (!desiredActive || (changeInfo.status !== "loading" && changeInfo.status !== "complete")) {
      return;
    }

    void enqueue(async () => {
      if (!desiredActive || styledTabs.has(tabId)) return;
      await applyToTab(tabId, true);
    });
  });

  return {
    setActive(active) {
      desiredActive = active;
      return enqueue(() => applyToAllTabs(active));
    },
  };
}

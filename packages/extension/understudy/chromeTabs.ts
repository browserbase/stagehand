export type ChromeTab = {
  id?: number;
  windowId: number;
};

export type ChromeDebuggerTarget = {
  id: string;
  tabId?: number;
  type: string;
};

export type ChromeTabTargetApi = {
  debugger: {
    getTargets(): Promise<ChromeDebuggerTarget[]>;
  };
  tabs: {
    query(queryInfo: { active: true; lastFocusedWindow: true }): Promise<ChromeTab[]>;
    update(tabId: number, updateProperties: { active: true }): Promise<ChromeTab | undefined>;
  };
  windows: {
    update(windowId: number, updateInfo: { focused: true }): Promise<unknown>;
  };
};

export type ChromeTabTargetController = {
  activeTargetId(): Promise<string | undefined>;
  targetIdForTabId(tabId: number): Promise<string | undefined>;
  tabIdForTargetId(targetId: string): Promise<number | undefined>;
  activateTarget(targetId: string): Promise<void>;
};

/** Correlates Chrome extension tab ids with the CDP target ids used by understudy pages. */
export class ChromeTabTargetAdapter implements ChromeTabTargetController {
  constructor(private readonly chromeApi: ChromeTabTargetApi) {}

  async activeTargetId(): Promise<string | undefined> {
    const [tab] = await this.chromeApi.tabs.query({
      active: true,
      lastFocusedWindow: true,
    });
    if (tab?.id === undefined) return undefined;
    return await this.targetIdForTabId(tab.id);
  }

  async targetIdForTabId(tabId: number): Promise<string | undefined> {
    const targets = await this.chromeApi.debugger.getTargets();
    return targets.find((target) => target.type === "page" && target.tabId === tabId)?.id;
  }

  async tabIdForTargetId(targetId: string): Promise<number | undefined> {
    const targets = await this.chromeApi.debugger.getTargets();
    return targets.find((target) => target.type === "page" && target.id === targetId)?.tabId;
  }

  async activateTarget(targetId: string): Promise<void> {
    const tabId = await this.tabIdForTargetId(targetId);
    if (tabId === undefined) {
      throw new Error(`Chrome tab for target "${targetId}" was not found`);
    }

    const [previousActiveTab] = await this.chromeApi.tabs.query({
      active: true,
      lastFocusedWindow: true,
    });
    const tab = await this.chromeApi.tabs.update(tabId, { active: true });
    if (!tab) {
      throw new Error(`Chrome did not return tab ${tabId} after activating target "${targetId}"`);
    }
    if (previousActiveTab?.windowId !== tab.windowId) {
      await this.chromeApi.windows.update(tab.windowId, { focused: true });
    }
  }
}

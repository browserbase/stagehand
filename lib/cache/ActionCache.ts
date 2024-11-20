import { BaseCache, CacheEntry } from "./BaseCache";

export interface PlaywrightCommand {
  method: string;
  args: string[];
}

export interface ActionEntry extends CacheEntry {
  data: {
    playwrightCommand: PlaywrightCommand;
    componentString: string;
    xpaths: string[];
    newStepString: string;
    completed: boolean;
    previousSelectors: string[];
    action: string;
  };
}

/**
 * ActionCache handles logging and retrieving actions along with their Playwright commands.
 */
export class ActionCache extends BaseCache<ActionEntry> {
  constructor(
    logger: (message: {
      category?: string;
      message: string;
      level?: number;
    }) => void,
    cacheDir?: string,
    cacheFile?: string,
  ) {
    super(logger, cacheDir, cacheFile || "action_cache.json");
  }

  public async addActionStep({
    url,
    action,
    previousSelectors,
    playwrightCommand,
    componentString,
    xpaths,
    newStepString,
    completed,
    requestId,
  }: {
    url: string;
    action: string;
    previousSelectors: string[];
    playwrightCommand: PlaywrightCommand;
    componentString: string;
    requestId: string;
    xpaths: string[];
    newStepString: string;
    completed: boolean;
  }): Promise<void> {
    this.logger({
      category: "action_cache",
      message: `Adding action step to cache: ${action}, requestId: ${requestId}, url: ${url}, previousSelectors: ${previousSelectors}`,
      level: 1,
    });

    await this.set(
      { url, action, previousSelectors },
      {
        playwrightCommand,
        componentString,
        xpaths,
        newStepString,
        completed,
        previousSelectors,
        action,
      },
      requestId,
    );
  }

  /**
   * Retrieves all actions for a specific trajectory.
   * @param trajectoryId - Unique identifier for the trajectory.
   * @param requestId - The identifier for the current request.
   * @returns An array of TrajectoryEntry objects or null if not found.
   */
  public async getActionStep({
    url,
    action,
    previousSelectors,
    requestId,
  }: {
    url: string;
    action: string;
    previousSelectors: string[];
    requestId: string;
  }): Promise<ActionEntry["data"] | null> {
    const data = await super.get({ url, action, previousSelectors }, requestId);
    if (!data) {
      return null;
    }

    return data;
  }

  public async removeActionStep(cacheHashObj: {
    url: string;
    action: string;
    previousSelectors: string[];
    requestId: string;
  }): Promise<void> {
    await super.delete(cacheHashObj);
  }

  /**
   * Clears all actions for a specific trajectory.
   * @param trajectoryId - Unique identifier for the trajectory.
   * @param requestId - The identifier for the current request.
   */
  public async clearAction(requestId: string): Promise<void> {
    await super.deleteCacheForRequestId(requestId);
    this.logger({
      category: "action_cache",
      message: `Cleared action for ID: ${requestId}`,
      level: 1,
    });
  }

  /**
   * Resets the entire action cache.
   */
  public async resetCache(): Promise<void> {
    await super.resetCache();
    this.logger({
      category: "action_cache",
      message: "Action cache has been reset.",
      level: 1,
    });
  }
}

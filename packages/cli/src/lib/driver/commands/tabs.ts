import type { DriverCommandHandlers } from "./types.js";
import { unavailableV4Command } from "./unavailable.js";

export const tabHandlers: DriverCommandHandlers = {
  async "tab.list"(manager) {
    return { tabs: await manager.pageSummaries() };
  },

  "tab.close": unavailableV4Command("tab.close"),
  "tab.new": unavailableV4Command("tab.new"),
  "tab.switch": unavailableV4Command("tab.switch"),
};

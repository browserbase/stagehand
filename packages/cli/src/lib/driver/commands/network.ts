import type { DriverCommandHandlers } from "./types.js";

export const networkHandlers: DriverCommandHandlers = {
  async "network.on"() {
    throw new Error("Network capture is not yet exposed by the Stagehand V4 client.");
  },

  async "network.off"(manager) {
    return manager.network.disable();
  },

  async "network.path"(manager) {
    return manager.network.path();
  },

  async "network.clear"(manager) {
    return manager.network.clear();
  },
};

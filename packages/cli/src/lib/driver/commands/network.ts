import type { DriverCommandHandlers } from "./types.js";

export const networkHandlers: DriverCommandHandlers = {
  async "network.on"(manager) {
    const page = await manager.activePage();
    const websocketUrl = await manager.networkWebSocketDebuggerUrl();
    return manager.network.enable(page, websocketUrl);
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

import type { DriverCommandHandlers } from "./types.js";
import { unavailableV4Command } from "./unavailable.js";

export const mouseHandlers: DriverCommandHandlers = {
  "mouse.click": unavailableV4Command("mouse.click"),
  "mouse.drag": unavailableV4Command("mouse.drag"),
  "mouse.hover": unavailableV4Command("mouse.hover"),
  "mouse.scroll": unavailableV4Command("mouse.scroll"),
};

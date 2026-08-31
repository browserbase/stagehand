import type { DriverCommandHandlers } from "./types.js";
import { unavailableV4Command } from "./unavailable.js";

export const elementsHandlers: DriverCommandHandlers = {
  click: unavailableV4Command("click"),
  fill: unavailableV4Command("fill"),
  highlight: unavailableV4Command("highlight"),
  select: unavailableV4Command("select"),
  upload: unavailableV4Command("upload"),
};

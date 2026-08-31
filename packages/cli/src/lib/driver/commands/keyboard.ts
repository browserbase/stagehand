import { z } from "zod";

import type { DriverCommandHandlers } from "./types.js";
import { unavailableV4Command } from "./unavailable.js";

export const keyboardHandlers: DriverCommandHandlers = {
  type: unavailableV4Command("type"),

  async key(manager, params) {
    const { key } = z.object({ key: z.string().min(1) }).parse(params);
    const page = await manager.activePage();
    await page.keyPress(key);
    return { pressed: key };
  },
};

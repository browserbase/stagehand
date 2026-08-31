import { z } from "zod";

import type { DriverCommandHandlers } from "./types.js";
import { unavailableV4Command } from "./unavailable.js";

export const pageInfoHandlers: DriverCommandHandlers = {
  get: unavailableV4Command("get"),
  is: unavailableV4Command("is"),

  async eval(manager, params) {
    const { expression } = z
      .object({ expression: z.string().min(1) })
      .parse(params);
    const page = await manager.activePage();
    return { result: await page.evaluate(expression) };
  },
};

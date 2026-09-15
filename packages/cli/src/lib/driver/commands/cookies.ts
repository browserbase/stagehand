import { z } from "zod";

import type { DriverCommandHandlers } from "./types.js";

const CookieSyncSchema = z.object({
  all: z.boolean().optional(),
  domains: z.array(z.string().min(1)).default([]),
  sourceCdp: z.string().min(1).optional(),
});

export const cookieHandlers: DriverCommandHandlers = {
  async "cookies.sync"(manager, params) {
    return manager.syncCookiesFromLocal(CookieSyncSchema.parse(params));
  },
};

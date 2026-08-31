import { z } from "zod";

import type { DriverCommandHandlers } from "./types.js";
import { unavailableV4Command } from "./unavailable.js";

const LoadStateSchema = z
  .enum(["load", "domcontentloaded", "networkidle"])
  .optional();
const NavigationOptionsSchema = z.object({
  timeoutMs: z.number().int().positive().optional(),
  waitUntil: LoadStateSchema,
});

const OpenSchema = NavigationOptionsSchema.extend({
  url: z.string().min(1),
});

export const navigationHandlers: DriverCommandHandlers = {
  async open(manager, params) {
    const { timeoutMs, url, waitUntil } = OpenSchema.parse(params);
    const page = await manager.pageForOpen();
    await page.goto(url, pageNavigationOptions({ timeoutMs, waitUntil }));
    return manager.openResult(page);
  },
  back: unavailableV4Command("back"),
  forward: unavailableV4Command("forward"),
  reload: unavailableV4Command("reload"),
};

function pageNavigationOptions({
  timeoutMs,
  waitUntil,
}: z.infer<typeof NavigationOptionsSchema>) {
  return {
    ...(timeoutMs === undefined ? {} : { timeout: timeoutMs }),
    ...(waitUntil === undefined ? {} : { waitUntil }),
  };
}

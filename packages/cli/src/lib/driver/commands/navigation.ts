import { z } from "zod";

import type { DriverCommandHandlers } from "./types.js";

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
    await page.goto(url, { timeoutMs, waitUntil });
    return manager.openResult(page);
  },

  async reload(manager, params) {
    const options = NavigationOptionsSchema.parse(params);
    const page = await manager.activePage();
    await page.reload(options);
    return manager.openResult(page);
  },

  async back(manager, params) {
    const options = NavigationOptionsSchema.parse(params);
    const page = await manager.activePage();
    await page.goBack(options);
    return manager.openResult(page);
  },

  async forward(manager, params) {
    const options = NavigationOptionsSchema.parse(params);
    const page = await manager.activePage();
    await page.goForward(options);
    return manager.openResult(page);
  },
};

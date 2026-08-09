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

/**
 * Understudy's navigation methods return a `Response | null` whose `status()` is
 * the top-level document's HTTP status. We read it directly (no correlation with
 * the network layer needed) to surface `httpStatus` on the navigation result.
 */
type NavigationResponse = { status: () => number } | null | undefined;

function responseStatus(response: NavigationResponse): number | undefined {
  const status = response?.status?.();
  return typeof status === "number" && status > 0 ? status : undefined;
}

export const navigationHandlers: DriverCommandHandlers = {
  async open(manager, params) {
    const { timeoutMs, url, waitUntil } = OpenSchema.parse(params);
    const page = await manager.pageForOpen();
    const response = (await page.goto(url, {
      timeoutMs,
      waitUntil,
    })) as NavigationResponse;
    return manager.openResult(page, responseStatus(response));
  },

  async reload(manager, params) {
    const options = NavigationOptionsSchema.parse(params);
    const page = await manager.activePage();
    const response = (await page.reload(options)) as NavigationResponse;
    return manager.openResult(page, responseStatus(response));
  },

  async back(manager, params) {
    const options = NavigationOptionsSchema.parse(params);
    const page = await manager.activePage();
    const response = (await page.goBack(options)) as NavigationResponse;
    return manager.openResult(page, responseStatus(response));
  },

  async forward(manager, params) {
    const options = NavigationOptionsSchema.parse(params);
    const page = await manager.activePage();
    const response = (await page.goForward(options)) as NavigationResponse;
    return manager.openResult(page, responseStatus(response));
  },
};

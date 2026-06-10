import type { Logger } from "../types/public/index.js";
import { Page } from "../understudy/page.js";

const DEFAULT_WAIT_TIMEOUT_MS = 15000;

export function cloneForCache<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export async function safeGetPageUrl(page: Page): Promise<string> {
  try {
    return page.url();
  } catch {
    return "";
  }
}

export function normalizeUrlForCacheKey(url: string): string {
  if (!url) return url;

  try {
    const parsedUrl = new URL(url);
    if (!parsedUrl.search) return url;

    const originalSearch = parsedUrl.search;
    parsedUrl.searchParams.sort();
    if (parsedUrl.search === originalSearch) return url;

    return parsedUrl.toString();
  } catch {
    return url;
  }
}

/**
 * Waits for a cached action's selector to be attached to the DOM before executing.
 * Logs a warning and proceeds if the wait times out (non-blocking).
 */
export async function waitForCachedSelector(params: {
  page: Page;
  selector: string | undefined;
  timeout: number | undefined;
  logger: Logger;
  context?: string;
}): Promise<void> {
  const { page, selector, timeout, logger, context } = params;
  if (!selector) return;

  try {
    await page.waitForSelector(selector, {
      state: "attached",
      timeout: timeout ?? DEFAULT_WAIT_TIMEOUT_MS,
    });
  } catch (err) {
    logger({
      category: "cache",
      message: `waitForSelector failed for ${context ?? "cached"} action selector, proceeding anyway`,
      level: 2,
      auxiliary: {
        selector: { value: selector, type: "string" },
        error: { value: String(err), type: "string" },
      },
    });
  }
}

import { z } from "zod";

import { DriverError } from "../errors.js";
import type { DriverPage } from "../session-manager.js";
import type { DriverCommandHandlers } from "./types.js";

const LoadStateSchema = z.enum(["load", "domcontentloaded", "networkidle"]).optional();
const NavigationOptionsSchema = z.object({
  timeoutMs: z.number().int().positive().optional(),
  waitUntil: LoadStateSchema,
});

const OpenSchema = NavigationOptionsSchema.extend({
  url: z.string().min(1),
});

/** URL of the page Chrome commits when a navigation fails at the network layer. */
const CHROME_ERROR_URL_PREFIX = "chrome-error://";

/** Reads the net error code, such as ERR_CONNECTION_REFUSED, from Chrome's error page. */
const CHROME_ERROR_CODE_EXPRESSION = `document.querySelector(".error-code")?.textContent?.trim() ?? ""`;

export const navigationHandlers: DriverCommandHandlers = {
  async open(manager, params) {
    const { timeoutMs, url, waitUntil } = OpenSchema.parse(params);
    const page = await manager.pageForOpen();
    await page.goto(url, pageNavigationOptions({ timeoutMs, waitUntil }));
    return failOnChromeErrorPage(page, await manager.openResult(page), url);
  },

  async reload(manager, params) {
    const options = NavigationOptionsSchema.parse(params);
    const page = await manager.activePage();
    await page.reload(pageNavigationOptions(options));
    return failOnChromeErrorPage(page, await manager.openResult(page));
  },

  async back(manager, params) {
    const options = NavigationOptionsSchema.parse(params);
    const page = await manager.activePage();
    await page.goBack(pageNavigationOptions(options));
    return failOnChromeErrorPage(page, await manager.openResult(page));
  },

  async forward(manager, params) {
    const options = NavigationOptionsSchema.parse(params);
    const page = await manager.activePage();
    await page.goForward(pageNavigationOptions(options));
    return failOnChromeErrorPage(page, await manager.openResult(page));
  },
};

function pageNavigationOptions({ timeoutMs, waitUntil }: z.infer<typeof NavigationOptionsSchema>) {
  return {
    ...(timeoutMs === undefined ? {} : { timeout: timeoutMs }),
    ...(waitUntil === undefined ? {} : { waitUntil }),
  };
}

/**
 * The V4 page resolves a navigation that fails at the network layer and leaves
 * Chrome's error page committed. This check raises `navigation_failed` in that
 * case, so the command exits non-zero instead of printing the error page as its result.
 */
async function failOnChromeErrorPage<T extends { url: string }>(
  page: DriverPage,
  result: T,
  requestedUrl?: string,
): Promise<T> {
  if (!result.url.startsWith(CHROME_ERROR_URL_PREFIX)) return result;
  const errorCode = await chromeErrorCode(page);
  const target = requestedUrl === undefined ? "Navigation" : `Navigation to ${requestedUrl}`;
  throw new DriverError(
    `${target} failed${errorCode ? ` (${errorCode})` : ""}; the browser is showing its error page.`,
    { code: "navigation_failed" },
  );
}

async function chromeErrorCode(page: DriverPage): Promise<string | undefined> {
  try {
    const code: unknown = await page.evaluate(CHROME_ERROR_CODE_EXPRESSION);
    return typeof code === "string" && /^[A-Z0-9_]+$/.test(code) ? code : undefined;
  } catch {
    return undefined;
  }
}

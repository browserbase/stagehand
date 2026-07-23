import type { Cookie, CookieParam } from "../../protocol/types.js";
import { CookieParamSchema } from "../../protocol/schemas.js";
import { z } from "zod/v4";

export type UnderstudyClearCookieOptions = {
  name?: string | RegExp;
  domain?: string | RegExp;
  path?: string | RegExp;
};

const CookieUrlsSchema = z.array(z.string()).superRefine((urls, context) => {
  for (const [index, url] of urls.entries()) {
    try {
      new URL(url);
    } catch {
      context.addIssue({
        code: "custom",
        path: [index],
        message: `Invalid URL passed to cookies(): "${url}"`,
      });
    }
  }
});

/**
 * helpers for browser cookie management.
 *
 * Mirrors Playwright's cookie API surface, adapted for direct CDP usage
 * against a single default browser context.
 */

/**
 * Filter cookies by URL matching (domain, path, secure).
 * If `urls` is empty every cookie passes.
 */
export function filterCookies(cookies: Cookie[], urls: string[]): Cookie[] {
  if (!urls.length) return cookies;
  const parsed = CookieUrlsSchema.parse(urls).map((url) => new URL(url));
  return cookies.filter((c) => {
    for (const url of parsed) {
      let domain = c.domain;
      if (!domain.startsWith(".")) domain = "." + domain;
      if (!("." + url.hostname).endsWith(domain)) continue;
      // Path must match on a "/" boundary: cookie path "/foo" should match
      // "/foo" and "/foo/bar" but NOT "/foobar".
      const p = url.pathname;
      if (
        !p.startsWith(c.path) ||
        (c.path.length < p.length && !c.path.endsWith("/") && p[c.path.length] !== "/")
      )
        continue;
      const isLoopback =
        url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
      if (url.protocol !== "https:" && !isLoopback && c.secure) continue;
      return true;
    }
    return false;
  });
}

/**
 * Validate and normalise `CookieParam` values before sending to CDP.
 *
 * - Ensures every cookie has either `url` or `domain`+`path`.
 * - When `url` is provided, derives `domain`, `path`, and `secure` from it.
 * - Validates that `sameSite: "None"` is paired with `secure: true`
 *   (browsers silently reject this — we throw early with a clear message).
 */
export function normalizeCookieParams(cookies: CookieParam[]): CookieParam[] {
  return CookieParamSchema.array()
    .parse(cookies)
    .map((cookie) => {
      const copy = { ...cookie };
      if (copy.url) {
        const url = new URL(copy.url);
        copy.domain = url.hostname;
        copy.path = url.pathname.substring(0, url.pathname.lastIndexOf("/") + 1);
        copy.secure = url.protocol === "https:";
        delete copy.url;
      }
      return copy;
    });
}

/**
 * Map a Cookie or CookieParam to the shape CDP's Storage.setCookies expects.
 * Session cookies (expires === -1) omit the expires field so CDP treats them
 * as session-scoped.
 */
export function toCdpCookieParam(c: Cookie | CookieParam): Record<string, unknown> {
  return {
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path,
    expires: c.expires === -1 ? undefined : c.expires,
    httpOnly: c.httpOnly,
    secure: c.secure,
    sameSite: c.sameSite,
  };
}

/**
 * Returns true if a cookie matches all supplied filter criteria.
 * Undefined filters are treated as "match anything".
 */
export function cookieMatchesFilter(
  cookie: Cookie,
  options: UnderstudyClearCookieOptions,
): boolean {
  const check = (prop: "name" | "domain" | "path", value: string | RegExp | undefined): boolean => {
    if (value === undefined) return true;
    if (value instanceof RegExp) {
      value.lastIndex = 0;
      return value.test(cookie[prop]);
    }
    return cookie[prop] === value;
  };
  return (
    check("name", options.name) && check("domain", options.domain) && check("path", options.path)
  );
}

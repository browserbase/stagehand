import {
  Cookie,
  CookieParam,
  ClearCookieOptions,
} from "../types/public/context";
import { CookieValidationError } from "../types/public/sdkErrors";

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
  const parsed = urls.map((u) => new URL(u));
  return cookies.filter((c) => {
    for (const url of parsed) {
      let domain = c.domain;
      if (!domain.startsWith(".")) domain = "." + domain;
      if (!("." + url.hostname).endsWith(domain)) continue;
      if (!url.pathname.startsWith(c.path)) continue;
      if (url.protocol !== "https:" && url.hostname !== "localhost" && c.secure)
        continue;
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
  return cookies.map((c) => {
    if (!c.url && !(c.domain && c.path)) {
      throw new CookieValidationError(
        `Cookie "${c.name}" must have a url or a domain/path pair`,
      );
    }
    if (c.url && c.domain) {
      throw new CookieValidationError(
        `Cookie "${c.name}" should have either url or domain, not both`,
      );
    }
    if (c.url && c.path) {
      throw new CookieValidationError(
        `Cookie "${c.name}" should have either url or path, not both`,
      );
    }
    if (c.expires !== undefined && c.expires < 0 && c.expires !== -1) {
      throw new CookieValidationError(
        `Cookie "${c.name}" has an invalid expires value; use -1 for session cookies or a positive unix timestamp`,
      );
    }

    const copy = { ...c };
    if (copy.url) {
      if (copy.url === "about:blank") {
        throw new CookieValidationError(
          `Blank page cannot have cookie "${c.name}"`,
        );
      }
      if (copy.url.startsWith("data:")) {
        throw new CookieValidationError(
          `Data URL page cannot have cookie "${c.name}"`,
        );
      }
      const url = new URL(copy.url);
      copy.domain = url.hostname;
      copy.path = url.pathname.substring(0, url.pathname.lastIndexOf("/") + 1);
      copy.secure = url.protocol === "https:";
      delete copy.url;
    }

    // Browsers silently reject SameSite=None cookies that aren't Secure.
    // Catch this early with a clear error instead of a silent CDP failure.
    // Use !copy.secure to catch both explicit false AND undefined (omitted),
    // since CDP defaults secure to false when omitted.
    if (copy.sameSite === "None" && !copy.secure) {
      throw new CookieValidationError(
        `Cookie "${c.name}" has sameSite: "None" without secure: true. ` +
          `Browsers require secure: true when sameSite is "None".`,
      );
    }

    return copy;
  });
}

/**
 * Returns true if a cookie matches all supplied filter criteria.
 * Undefined filters are treated as "match anything".
 */
export function cookieMatchesFilter(
  cookie: Cookie,
  options: ClearCookieOptions,
): boolean {
  const check = (
    prop: "name" | "domain" | "path",
    value: string | RegExp | undefined,
  ): boolean => {
    if (value === undefined) return true;
    if (value instanceof RegExp) {
      value.lastIndex = 0;
      return value.test(cookie[prop]);
    }
    return cookie[prop] === value;
  };
  return (
    check("name", options.name) &&
    check("domain", options.domain) &&
    check("path", options.path)
  );
}

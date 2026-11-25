import type { Cookie, CookieParam } from "@browserbasehq/stagehand-protocol/types";
import { CookieParamSchema } from "@browserbasehq/stagehand-protocol/schemas";
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

function isIpHostname(hostname: string): boolean {
  return hostname.startsWith("[") || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname);
}

function domainMatches(requestHost: string, cookieDomain: string): boolean {
  const host = requestHost.toLowerCase();
  const domain = cookieDomain.toLowerCase();
  if (!host || !domain) return false;
  if (!domain.startsWith(".")) return host === domain;
  const bare = domain.slice(1);
  if (!bare || bare.startsWith(".")) return false;
  // RFC 6265 §5.1.3: domain-attribute cookies never subdomain-match IP literals.
  if (isIpHostname(host)) return false;
  return host === bare || host.endsWith(domain);
}

function pathMatches(requestPath: string, cookiePath: string): boolean {
  if (!cookiePath.startsWith("/") || !requestPath.startsWith("/")) return false;
  if (requestPath === cookiePath) return true;
  if (!requestPath.startsWith(cookiePath)) return false;
  return cookiePath.endsWith("/") || requestPath[cookiePath.length] === "/";
}

function secureMatches(url: URL, cookieSecure: boolean): boolean {
  if (!cookieSecure) return true;
  if (url.protocol === "https:" || url.protocol === "wss:") return true;
  const isLoopback =
    url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  return (url.protocol === "http:" || url.protocol === "ws:") && isLoopback;
}

export function filterCookies(cookies: Cookie[], urls: string[]): Cookie[] {
  if (!urls.length) return cookies;
  const parsed = CookieUrlsSchema.parse(urls).map((url) => new URL(url));
  return cookies.filter((c) => {
    for (const url of parsed) {
      if (!domainMatches(url.hostname, c.domain)) continue;
      if (!pathMatches(url.pathname, c.path)) continue;
      if (!secureMatches(url, c.secure)) continue;
      return true;
    }
    return false;
  });
}

export function normalizeCookieParams(cookies: CookieParam[]): CookieParam[] {
  return CookieParamSchema.array()
    .parse(cookies)
    .map((cookie) => {
      const copy = { ...cookie };
      if (copy.url) {
        const url = new URL(copy.url);
        copy.domain = url.hostname;
        copy.path = url.pathname.substring(0, url.pathname.lastIndexOf("/") + 1) || "/";
        copy.secure = copy.secure ?? url.protocol === "https:";
        delete copy.url;
      } else if (copy.domain) {
        copy.domain = copy.domain.toLowerCase();
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

import type { DriverContext } from "./session-manager.js";

type BrowserCookie = Awaited<ReturnType<DriverContext["cookies"]>>[number];

export function normalizeCookieDomains(domains: string[]): string[] {
  return [
    ...new Set(
      domains.map((domain) => domain.trim().replace(/^\./, "").toLowerCase()),
    ),
  ].filter(Boolean);
}

export function filterCookiesByDomains(
  cookies: BrowserCookie[],
  domains: string[],
): BrowserCookie[] {
  const normalizedDomains = normalizeCookieDomains(domains);
  if (normalizedDomains.length === 0) return cookies;

  return cookies.filter((cookie) => {
    const cookieDomain = cookie.domain.replace(/^\./, "").toLowerCase();
    return normalizedDomains.some(
      (domain) =>
        cookieDomain === domain || cookieDomain.endsWith(`.${domain}`),
    );
  });
}

import { isIP } from "node:net";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { z } from "zod/v4";
import type { Cookie, CookieParam } from "@browserbasehq/stagehand-protocol/types";
import {
  cookieMatchesFilter,
  filterCookies,
  normalizeCookieParams,
  toCdpCookieParam,
} from "./cookies.js";

const BASE_SEED = 20261124;

function isIpLiteralHost(hostname: string): boolean {
  const unwrapped =
    hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
  return isIP(unwrapped) !== 0;
}

function rfc6265SecureMatches(url: URL, cookieSecure: boolean): boolean {
  if (!cookieSecure) return true;
  if (url.protocol === "https:" || url.protocol === "wss:") return true;
  const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
  return (
    (url.protocol === "http:" || url.protocol === "ws:") &&
    loopbackHosts.has(url.hostname.toLowerCase())
  );
}

/**
 * Independent RFC 6265 §5.1.3 / §5.1.4 / §5.4 oracle derived via label arrays,
 * `node:net` IP classification, and segment boundary matching rather than
 * reusing the production `cookies.ts` implementation.
 */
function rfc6265OracleMatches(cookie: Cookie, url: URL): boolean {
  const host = url.hostname.toLowerCase();
  const rawDomain = cookie.domain.toLowerCase();
  if (!host || !rawDomain) return false;

  let domainOk: boolean;
  if (rawDomain.startsWith(".")) {
    const stripped = rawDomain.slice(1);
    if (!stripped || stripped.startsWith(".")) {
      domainOk = false;
    } else if (host === stripped) {
      domainOk = true;
    } else if (isIpLiteralHost(host)) {
      domainOk = false;
    } else {
      const hostLabels = host.split(".");
      const domainLabels = stripped.split(".");
      domainOk =
        hostLabels.length > domainLabels.length &&
        domainLabels.every(
          (label, idx) => hostLabels[hostLabels.length - domainLabels.length + idx] === label,
        );
    }
  } else {
    domainOk = host === rawDomain;
  }
  if (!domainOk) return false;

  const reqPath = url.pathname;
  const cPath = cookie.path;
  if (!cPath.startsWith("/") || !reqPath.startsWith("/")) return false;
  const normalizedCookiePrefix = cPath.endsWith("/") ? cPath : `${cPath}/`;
  const pathOk = reqPath === cPath || reqPath.startsWith(normalizedCookiePrefix);
  if (!pathOk) return false;

  return rfc6265SecureMatches(url, cookie.secure);
}

const labelArb = fc.stringMatching(/^[a-z][a-z0-9-]{0,6}[a-z0-9]$/);
const dnsHostArb = fc
  .array(labelArb, { minLength: 2, maxLength: 4 })
  .map((labels) => labels.join("."));

const mixedCaseHostArb = fc
  .tuple(dnsHostArb, fc.boolean(), fc.boolean())
  .map(([host, upper, trailingDot]) => {
    const cased = upper ? host.toUpperCase() : host;
    return trailingDot ? `${cased}.` : cased;
  });

const ipHostArb = fc.oneof(
  fc.constant("127.0.0.1"),
  fc.constant("[::1]"),
  fc.constant("[2001:db8::1]"),
  fc
    .tuple(
      fc.integer({ min: 1, max: 223 }),
      fc.integer({ min: 0, max: 255 }),
      fc.integer({ min: 0, max: 255 }),
      fc.integer({ min: 1, max: 254 }),
    )
    .map(([a, b, c, d]) => `${a}.${b}.${c}.${d}`),
);

const urlHostArb = fc.oneof(
  mixedCaseHostArb,
  ipHostArb,
  fc.constantFrom(
    "localhost",
    "LOCALHOST",
    "localhost.evil.com",
    "127.0.0.1.evil.com",
    "example.com",
    "sub.example.com",
    "notexample.com",
  ),
);

const pathSegmentArb = fc.stringMatching(/^[a-zA-Z0-9_-]{1,8}$/);
const pathArb = fc
  .tuple(fc.array(pathSegmentArb, { maxLength: 4 }), fc.boolean())
  .map(([segments, trailingSlash]) => {
    if (segments.length === 0) return "/";
    return `/${segments.join("/")}${trailingSlash ? "/" : ""}`;
  });

const schemeArb = fc.constantFrom("https:", "http:", "wss:", "ws:", "ftp:");
const optionalPortArb = fc.option(fc.integer({ min: 80, max: 65535 }), { nil: undefined });

const validUrlArb = fc
  .tuple(schemeArb, urlHostArb, optionalPortArb, pathArb)
  .map(([scheme, host, port, path]) => {
    const portSuffix = port !== undefined ? `:${port}` : "";
    return `${scheme}//${host}${portSuffix}${path}`;
  });

function baseCookie(overrides: Partial<Cookie> = {}): Cookie {
  return {
    name: "sid",
    value: "val",
    domain: "example.com",
    path: "/",
    expires: -1,
    httpOnly: false,
    secure: false,
    sameSite: "Lax",
    ...overrides,
  };
}

describe("cookies RFC 6265 adversarial properties", () => {
  it("matches the RFC 6265 reference oracle across arbitrary domains, paths, ports, schemes, and IPs", () => {
    const cookieDomainArb = fc.oneof(
      mixedCaseHostArb,
      mixedCaseHostArb.map((h) => `.${h}`),
      ipHostArb,
      ipHostArb.map((ip) => `.${ip}`),
      fc.constantFrom(
        "",
        ".",
        "..",
        "..example.com",
        ".0.1",
        ".1",
        "EXAMPLE.COM",
        ".EXAMPLE.COM",
        "example.com.",
        ".example.com.",
        "localhost",
        ".localhost",
      ),
    );
    const cookiePathArb = fc.oneof(
      pathArb,
      fc.constantFrom("", "app", "app/", "/", "/app", "/app/", "/app2"),
    );

    fc.assert(
      fc.property(
        cookieDomainArb,
        cookiePathArb,
        fc.boolean(),
        validUrlArb,
        (domain, path, secure, urlString) => {
          const cookie = baseCookie({ domain, path, secure });
          const parsedUrl = new URL(urlString);
          const expected = rfc6265OracleMatches(cookie, parsedUrl) ? [cookie] : [];
          expect(filterCookies([cookie], [urlString])).toStrictEqual(expected);
        },
      ),
      { seed: BASE_SEED, numRuns: 500 },
    );
  });

  it("blocks subdomain suffix attacks for both host-only and dotted cookie domains", () => {
    fc.assert(
      fc.property(
        labelArb,
        dnsHostArb,
        fc.boolean(),
        fc.boolean(),
        (prefix, domain, leadingDot, upperCookie) => {
          const attackerHost = `${prefix}${domain}`;
          const rawDomain = `${leadingDot ? "." : ""}${domain}`;
          const cookieDomain = upperCookie ? rawDomain.toUpperCase() : rawDomain;
          const cookie = baseCookie({ domain: cookieDomain });

          expect(filterCookies([cookie], [`https://${attackerHost}/`])).toStrictEqual([]);
          expect(filterCookies([cookie], [`https://${domain}/`])).toStrictEqual([cookie]);

          const subHost = `${prefix}.${domain}`;
          expect(filterCookies([cookie], [`https://${subHost}/`])).toStrictEqual(
            leadingDot ? [cookie] : [],
          );
        },
      ),
      { seed: BASE_SEED + 1, numRuns: 200 },
    );
  });

  it("allows identical IP domain matches per RFC 6265 §5.1.3 while blocking IP suffix matches", () => {
    const tableCases: Array<{ domain: string; url: string; expected: boolean }> = [
      { domain: ".127.0.0.1", url: "http://127.0.0.1/", expected: true },
      { domain: "127.0.0.1", url: "https://127.0.0.1/", expected: true },
      { domain: ".0.0.1", url: "http://127.0.0.1/", expected: false },
      { domain: ".1", url: "http://127.0.0.1/", expected: false },
      { domain: ".[::1]", url: "http://[::1]/", expected: true },
      { domain: "[::1]", url: "https://[::1]/", expected: true },
      { domain: ".example.com", url: "https://example.com/", expected: true },
      { domain: ".example.com", url: "https://sub.example.com/", expected: true },
      { domain: ".example.com", url: "https://evil-example.com/", expected: false },
      { domain: "example.com", url: "https://sub.example.com/", expected: false },
      { domain: "..example.com", url: "https://sub.example.com/", expected: false },
    ];
    for (const tc of tableCases) {
      const cookie = baseCookie({ domain: tc.domain });
      expect(filterCookies([cookie], [tc.url])).toStrictEqual(tc.expected ? [cookie] : []);
    }

    fc.assert(
      fc.property(ipHostArb, (ip) => {
        const exactDotted = baseCookie({ domain: `.${ip}` });
        expect(filterCookies([exactDotted], [`http://${ip}/`])).toStrictEqual([exactDotted]);
        expect(filterCookies([exactDotted], [`https://${ip}/`])).toStrictEqual([exactDotted]);

        if (!ip.startsWith("[")) {
          const suffixCookie = baseCookie({ domain: `.${ip.split(".").slice(1).join(".")}` });
          expect(filterCookies([suffixCookie], [`http://${ip}/`])).toStrictEqual([]);
          expect(filterCookies([suffixCookie], [`https://${ip}/`])).toStrictEqual([]);
        }
      }),
      { seed: BASE_SEED + 2, numRuns: 100 },
    );
  });

  it("blocks path prefix boundary attacks and enforces monotonic descendant matching", () => {
    fc.assert(
      fc.property(
        fc.array(pathSegmentArb, { minLength: 1, maxLength: 3 }),
        pathSegmentArb,
        pathSegmentArb,
        (segments, suffixCollision, childSegment) => {
          const cookiePath = `/${segments.join("/")}`;
          const cookie = baseCookie({ path: cookiePath });

          expect(
            filterCookies([cookie], [`https://example.com${cookiePath}${suffixCollision}`]),
          ).toStrictEqual([]);
          expect(filterCookies([cookie], [`https://example.com${cookiePath}`])).toStrictEqual([
            cookie,
          ]);
          expect(filterCookies([cookie], [`https://example.com${cookiePath}/`])).toStrictEqual([
            cookie,
          ]);
          expect(
            filterCookies([cookie], [`https://example.com${cookiePath}/${childSegment}`]),
          ).toStrictEqual([cookie]);
        },
      ),
      { seed: BASE_SEED + 3, numRuns: 200 },
    );
  });

  it("never leaks Secure cookies over non-loopback HTTP/WS or any FTP URL", () => {
    fc.assert(
      fc.property(
        dnsHostArb,
        fc.constantFrom("http:", "ws:", "ftp:"),
        optionalPortArb,
        pathArb,
        (host, scheme, port, path) => {
          const cookie = baseCookie({ domain: host, path: "/", secure: true });
          const url = `${scheme}//${host}${port !== undefined ? `:${port}` : ""}${path}`;
          expect(filterCookies([cookie], [url])).toStrictEqual([]);
        },
      ),
      { seed: BASE_SEED + 4, numRuns: 150 },
    );

    fc.assert(
      fc.property(fc.constantFrom("localhost", "127.0.0.1", "[::1]"), pathArb, (host, path) => {
        const cookie = baseCookie({ domain: host, path: "/", secure: true });
        expect(filterCookies([cookie], [`ftp://${host}${path}`])).toStrictEqual([]);
        expect(filterCookies([cookie], [`http://${host}${path}`])).toStrictEqual([cookie]);
        expect(filterCookies([cookie], [`https://${host}${path}`])).toStrictEqual([cookie]);
      }),
      { seed: BASE_SEED + 5, numRuns: 50 },
    );
  });

  it("satisfies empty-URL identity, multi-URL disjunction, and no-duplication invariants", () => {
    const cookieArb: fc.Arbitrary<Cookie> = fc.record({
      name: fc.stringMatching(/^[a-z]{1,6}$/),
      value: fc.string({ maxLength: 8 }),
      domain: fc.oneof(
        dnsHostArb,
        dnsHostArb.map((d) => `.${d}`),
        fc.constant("example.com"),
      ),
      path: pathArb,
      expires: fc.oneof(fc.constant(-1), fc.integer({ min: 0, max: 2_000_000_000 })),
      httpOnly: fc.boolean(),
      secure: fc.boolean(),
      sameSite: fc.constantFrom("Strict", "Lax", "None"),
    });

    fc.assert(
      fc.property(
        fc.array(cookieArb, { maxLength: 10 }),
        fc.array(validUrlArb, { minLength: 1, maxLength: 5 }),
        (cookies, urls) => {
          expect(filterCookies(cookies, [])).toStrictEqual(cookies);

          const filtered = filterCookies(cookies, urls);
          const parsedUrls = urls.map((u) => new URL(u));
          const expected = cookies.filter((c) =>
            parsedUrls.some((u) => rfc6265OracleMatches(c, u)),
          );
          expect(filtered).toStrictEqual(expected);
        },
      ),
      { seed: BASE_SEED + 6, numRuns: 150 },
    );
  });

  describe("normalizeCookieParams and toCdpCookieParam invariants", () => {
    it("preserves explicit secure flags, derives safe defaults from HTTP(S) URLs, and round-trips through filterCookies", () => {
      fc.assert(
        fc.property(
          fc.constantFrom("http:", "https:"),
          fc.oneof(mixedCaseHostArb, fc.constantFrom("localhost", "127.0.0.1")),
          optionalPortArb,
          pathArb,
          fc.option(fc.boolean(), { nil: undefined }),
          fc.option(fc.constantFrom("Strict" as const, "Lax" as const, "None" as const), {
            nil: undefined,
          }),
          (scheme, host, port, path, explicitSecure, sameSite) => {
            const url = `${scheme}//${host}${port !== undefined ? `:${port}` : ""}${path}`;
            const param: CookieParam = {
              name: "tok",
              value: "v",
              url,
              ...(explicitSecure !== undefined ? { secure: explicitSecure } : {}),
              ...(sameSite !== undefined ? { sameSite } : {}),
            };
            const effectiveSecure = explicitSecure ?? scheme === "https:";

            if (sameSite === "None" && !effectiveSecure) {
              expect(() => normalizeCookieParams([param])).toThrow(z.ZodError);
              return;
            }

            const [normalized] = normalizeCookieParams([param]);
            expect(normalized).toBeDefined();
            expect(normalized!.url).toBeUndefined();
            expect(normalized!.domain).toBe(new URL(url).hostname);
            expect(normalized!.path?.startsWith("/")).toBe(true);
            expect(normalized!.path?.endsWith("/")).toBe(true);
            expect(normalized!.secure).toBe(effectiveSecure);

            const materialized: Cookie = {
              name: normalized!.name,
              value: normalized!.value,
              domain: normalized!.domain!,
              path: normalized!.path!,
              expires: normalized!.expires ?? -1,
              httpOnly: normalized!.httpOnly ?? false,
              secure: normalized!.secure ?? false,
              sameSite: normalized!.sameSite ?? "Lax",
            };
            const parsedUrl = new URL(url);
            const expectedMatch = rfc6265SecureMatches(parsedUrl, materialized.secure);
            expect(filterCookies([materialized], [url])).toStrictEqual(
              expectedMatch ? [materialized] : [],
            );
          },
        ),
        { seed: BASE_SEED + 10, numRuns: 250 },
      );
    });

    it("enforces expires validation and maps session cookies (-1) to undefined in toCdpCookieParam", () => {
      fc.assert(
        fc.property(
          fc.oneof(
            fc.constant(-1),
            fc.constant(0),
            fc.double({ min: 0.001, max: 2_000_000_000, noNaN: true }),
            fc.double({ min: -1_000_000, max: -0.0001, noNaN: true }),
            fc.constant(Number.NaN),
            fc.constant(Number.POSITIVE_INFINITY),
            fc.constant(Number.NEGATIVE_INFINITY),
          ),
          (expires) => {
            const param: CookieParam = {
              name: "exp",
              value: "1",
              domain: "example.com",
              path: "/",
              expires,
            };
            const isValid = Number.isFinite(expires) && (expires >= 0 || expires === -1);
            if (!isValid) {
              expect(() => normalizeCookieParams([param])).toThrow(z.ZodError);
              return;
            }
            const [normalized] = normalizeCookieParams([param]);
            const cdp = toCdpCookieParam(normalized!);
            expect(cdp.expires).toBe(expires === -1 ? undefined : expires);
          },
        ),
        { seed: BASE_SEED + 11, numRuns: 150 },
      );
    });

    it("never produces empty path from opaque non-hierarchical URLs", () => {
      for (const opaqueUrl of ["mailto:user@example.com", "custom:opaque-value"]) {
        const [normalized] = normalizeCookieParams([{ name: "c", value: "1", url: opaqueUrl }]);
        expect(normalized?.path).toBe("/");
      }
    });
  });

  describe("cookieMatchesFilter invariants", () => {
    it("is conjunctive across fields and immune to RegExp lastIndex statefulness", () => {
      const cookieArb: fc.Arbitrary<Cookie> = fc.record({
        name: fc.constantFrom("session", "sid_1", "sid_2", "_ga"),
        value: fc.string({ maxLength: 6 }),
        domain: fc.constantFrom("example.com", ".example.com", "sub.example.com"),
        path: fc.constantFrom("/", "/app", "/app/v1"),
        expires: fc.constant(-1),
        httpOnly: fc.boolean(),
        secure: fc.boolean(),
        sameSite: fc.constantFrom("Strict", "Lax", "None"),
      });

      const matcherArb = (samples: string[]) =>
        fc.oneof(
          fc.constant(undefined),
          fc.constantFrom(...samples),
          fc
            .constantFrom("g", "y", "gi", "i", "")
            .map((flags) => new RegExp("sid|example|app", flags)),
        );

      fc.assert(
        fc.property(
          fc.array(cookieArb, { minLength: 2, maxLength: 8 }),
          matcherArb(["session", "sid_1", "other"]),
          matcherArb(["example.com", ".example.com", "other.test"]),
          matcherArb(["/", "/app", "/other"]),
          fc.integer({ min: 0, max: 20 }),
          (cookies, name, domain, path, presetLastIndex) => {
            for (const c of cookies) {
              expect(cookieMatchesFilter(c, {})).toBe(true);
            }

            const firstPass = cookies.map((c) => {
              if (name instanceof RegExp) name.lastIndex = presetLastIndex;
              if (domain instanceof RegExp) domain.lastIndex = presetLastIndex;
              if (path instanceof RegExp) path.lastIndex = presetLastIndex;
              const combined = cookieMatchesFilter(c, { name, domain, path });
              const conjunctive =
                cookieMatchesFilter(c, { name }) &&
                cookieMatchesFilter(c, { domain }) &&
                cookieMatchesFilter(c, { path });
              expect(combined).toBe(conjunctive);
              return combined;
            });

            const secondPass = cookies.map((c) => cookieMatchesFilter(c, { name, domain, path }));
            expect(secondPass).toStrictEqual(firstPass);
          },
        ),
        { seed: BASE_SEED + 20, numRuns: 150 },
      );
    });
  });
});

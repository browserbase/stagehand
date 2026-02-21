import { beforeEach, describe, expect, it } from "vitest";
import {
  filterCookies,
  normalizeCookieParams,
  cookieMatchesFilter,
} from "../../lib/v3/understudy/cookies.js";
import { MockCDPSession } from "./helpers/mockCDPSession.js";
import type { V3Context } from "../../lib/v3/understudy/context.js";
import { Cookie, CookieParam } from "../../lib/v3/types/public/context.js";

function makeCookie(overrides: Partial<Cookie> = {}): Cookie {
  return {
    name: "sid",
    value: "abc123",
    domain: "example.com",
    path: "/",
    expires: -1,
    httpOnly: false,
    secure: false,
    sameSite: "Lax",
    ...overrides,
  };
}

/** Convert our Cookie type into the shape CDP's Storage.getCookies returns. */
function toCdpCookie(c: Cookie) {
  return {
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path,
    expires: c.expires,
    httpOnly: c.httpOnly,
    secure: c.secure,
    sameSite: c.sameSite,
    size: c.name.length + c.value.length,
    session: c.expires === -1,
    priority: "Medium",
    sameParty: false,
    sourceScheme: "Secure",
    sourcePort: 443,
  };
}

describe("filterCookies", () => {
  const cookies: Cookie[] = [
    makeCookie({ name: "a", domain: "example.com", path: "/", secure: false }),
    makeCookie({
      name: "b",
      domain: ".example.com",
      path: "/app",
      secure: true,
    }),
    makeCookie({ name: "c", domain: "other.com", path: "/", secure: false }),
    makeCookie({
      name: "d",
      domain: "sub.example.com",
      path: "/",
      secure: false,
    }),
  ];

  it("returns all cookies when urls is empty", () => {
    expect(filterCookies(cookies, [])).toEqual(cookies);
  });

  it("filters by domain (exact host match)", () => {
    const result = filterCookies(cookies, ["http://example.com/"]);
    const names = result.map((c) => c.name);
    expect(names).toContain("a");
    // "b" (.example.com) domain-matches but is secure — excluded on http://
    expect(names).not.toContain("b");
    expect(names).not.toContain("c");
    expect(names).not.toContain("d");
  });

  it("filters by domain (dot-prefixed domain matches on https)", () => {
    const result = filterCookies(cookies, ["https://example.com/app/settings"]);
    const names = result.map((c) => c.name);
    expect(names).toContain("a"); // example.com domain match, path "/" prefix
    expect(names).toContain("b"); // .example.com domain match + secure + https
  });

  it("filters by domain (subdomain matches dot-prefixed domain)", () => {
    const result = filterCookies(cookies, ["http://sub.example.com/"]);
    const names = result.map((c) => c.name);
    // "a" (example.com) → prepend dot → .example.com → matches .sub.example.com
    expect(names).toContain("a");
    // "b" (.example.com) domain-matches sub.example.com but is secure — excluded on http://
    expect(names).not.toContain("b");
    expect(names).toContain("d"); // sub.example.com matches exactly
    expect(names).not.toContain("c");
  });

  it("filters by path prefix", () => {
    const result = filterCookies(cookies, ["https://example.com/app/settings"]);
    const names = result.map((c) => c.name);
    expect(names).toContain("a"); // path "/" is a prefix of "/app/settings"
    expect(names).toContain("b"); // path "/app" is a prefix of "/app/settings"
  });

  it("excludes secure cookies for non-https URLs", () => {
    const result = filterCookies(cookies, ["http://example.com/app/page"]);
    const names = result.map((c) => c.name);
    expect(names).toContain("a");
    expect(names).not.toContain("b"); // secure cookie, http URL
  });

  it("allows secure cookies on loopback addresses regardless of protocol", () => {
    const cases = [
      { domain: "localhost", url: "http://localhost/" },
      { domain: "127.0.0.1", url: "http://127.0.0.1/" },
      { domain: "[::1]", url: "http://[::1]/" },
    ];
    for (const { domain, url } of cases) {
      const cookie = makeCookie({ name: "loop", domain, secure: true });
      const result = filterCookies([cookie], [url]);
      expect(result).toHaveLength(1);
      expect(result[0]!.name).toBe("loop");
    }
  });

  it("matches against multiple URLs (union)", () => {
    const result = filterCookies(cookies, [
      "http://example.com/",
      "http://other.com/",
    ]);
    const names = result.map((c) => c.name);
    expect(names).toContain("a");
    expect(names).toContain("c");
  });

  it("returns empty array when no cookies match any URL", () => {
    const result = filterCookies(cookies, ["http://nomatch.dev/"]);
    expect(result).toHaveLength(0);
  });

  it("returns empty array when cookie list is empty", () => {
    const result = filterCookies([], ["http://example.com/"]);
    expect(result).toHaveLength(0);
  });

  it("does not match a sibling subdomain against a host-only domain", () => {
    // Cookie for "api.example.com" should NOT match "www.example.com"
    const apiCookie = makeCookie({ name: "api", domain: "api.example.com" });
    const result = filterCookies([apiCookie], ["http://www.example.com/"]);
    expect(result).toHaveLength(0);
  });

  it("does not match a parent domain against a more specific cookie", () => {
    // Cookie for "sub.example.com" should NOT match "example.com"
    const subCookie = makeCookie({ name: "sub", domain: "sub.example.com" });
    const result = filterCookies([subCookie], ["http://example.com/"]);
    expect(result).toHaveLength(0);
  });

  it("does not match when path does not prefix the URL path", () => {
    const deepCookie = makeCookie({
      name: "deep",
      domain: "example.com",
      path: "/admin",
    });
    const result = filterCookies([deepCookie], ["http://example.com/public"]);
    expect(result).toHaveLength(0);
  });

  it("does not match when cookie path is a string prefix but not a path boundary", () => {
    // "/foo" should NOT match "/foobar" — only "/foo", "/foo/", "/foo/bar"
    const cookie = makeCookie({
      name: "boundary",
      domain: "example.com",
      path: "/foo",
    });
    expect(filterCookies([cookie], ["http://example.com/foobar"])).toHaveLength(
      0,
    );
    expect(filterCookies([cookie], ["http://example.com/foo"])).toHaveLength(1);
    expect(
      filterCookies([cookie], ["http://example.com/foo/bar"]),
    ).toHaveLength(1);
  });

  it("matches root path against any URL path", () => {
    const rootCookie = makeCookie({
      name: "root",
      domain: "example.com",
      path: "/",
    });
    const result = filterCookies(
      [rootCookie],
      ["http://example.com/deeply/nested/page"],
    );
    expect(result).toHaveLength(1);
  });

  it("handles URL with port numbers", () => {
    const c = makeCookie({ name: "port", domain: "localhost", path: "/" });
    const result = filterCookies([c], ["http://localhost:3000/api"]);
    expect(result).toHaveLength(1);
  });

  it("handles URL with query string and fragment", () => {
    const c = makeCookie({ name: "q", domain: "example.com", path: "/" });
    const result = filterCookies(
      [c],
      ["http://example.com/page?q=1&r=2#section"],
    );
    expect(result).toHaveLength(1);
  });

  it("throws CookieValidationError for malformed URL", () => {
    const c = makeCookie({ name: "a", domain: "example.com" });
    expect(() => filterCookies([c], ["not-a-valid-url"])).toThrow(
      /Invalid URL passed to cookies\(\)/,
    );
  });
});

describe("normalizeCookieParams", () => {
  it("passes through cookies with domain+path", () => {
    const input: CookieParam[] = [
      { name: "a", value: "1", domain: "example.com", path: "/" },
    ];
    const result = normalizeCookieParams(input);
    expect(result[0]!.domain).toBe("example.com");
    expect(result[0]!.path).toBe("/");
    expect(result[0]!.url).toBeUndefined();
  });

  it("derives domain, path, and secure from url", () => {
    const input: CookieParam[] = [
      { name: "a", value: "1", url: "https://example.com/app/page" },
    ];
    const result = normalizeCookieParams(input);
    expect(result[0]!.domain).toBe("example.com");
    expect(result[0]!.path).toBe("/app/");
    expect(result[0]!.secure).toBe(true);
    expect(result[0]!.url).toBeUndefined();
  });

  it("sets secure to false for http urls", () => {
    const input: CookieParam[] = [
      { name: "a", value: "1", url: "http://example.com/" },
    ];
    const result = normalizeCookieParams(input);
    expect(result[0]!.secure).toBe(false);
  });

  it("throws when neither url nor domain+path is provided", () => {
    expect(() => normalizeCookieParams([{ name: "a", value: "1" }])).toThrow(
      /must have a url or a domain\/path pair/,
    );
  });

  it("throws when both url and domain are provided", () => {
    expect(() =>
      normalizeCookieParams([
        { name: "a", value: "1", url: "https://x.com/", domain: "x.com" },
      ]),
    ).toThrow(/should have either url or domain/);
  });

  it("throws when both url and path are provided", () => {
    expect(() =>
      normalizeCookieParams([
        { name: "a", value: "1", url: "https://x.com/", path: "/" },
      ]),
    ).toThrow(/should have either url or path/);
  });

  it("throws for invalid expires (negative, not -1)", () => {
    expect(() =>
      normalizeCookieParams([
        { name: "a", value: "1", domain: "x.com", path: "/", expires: -5 },
      ]),
    ).toThrow(/invalid expires/);
  });

  it("allows expires of -1 (session cookie)", () => {
    const result = normalizeCookieParams([
      { name: "a", value: "1", domain: "x.com", path: "/", expires: -1 },
    ]);
    expect(result[0]!.expires).toBe(-1);
  });

  it("allows a positive expires timestamp", () => {
    const future = Math.floor(Date.now() / 1000) + 3600;
    const result = normalizeCookieParams([
      { name: "a", value: "1", domain: "x.com", path: "/", expires: future },
    ]);
    expect(result[0]!.expires).toBe(future);
  });

  it("throws for about:blank url", () => {
    expect(() =>
      normalizeCookieParams([{ name: "a", value: "1", url: "about:blank" }]),
    ).toThrow(/Blank page/);
  });

  it("throws for data: url", () => {
    expect(() =>
      normalizeCookieParams([
        { name: "a", value: "1", url: "data:text/html,hi" },
      ]),
    ).toThrow(/Data URL/);
  });

  it("throws CookieValidationError for malformed url", () => {
    expect(() =>
      normalizeCookieParams([{ name: "a", value: "1", url: "not-a-url" }]),
    ).toThrow(/Cookie "a" has an invalid url/);
  });

  it("throws when sameSite is None but secure is false", () => {
    expect(() =>
      normalizeCookieParams([
        {
          name: "a",
          value: "1",
          domain: "x.com",
          path: "/",
          sameSite: "None",
          secure: false,
        },
      ]),
    ).toThrow(/sameSite: "None" without secure: true/);
  });

  it("throws when sameSite is None and secure is omitted (undefined)", () => {
    // CDP defaults secure to false when omitted, so the browser will reject it.
    expect(() =>
      normalizeCookieParams([
        { name: "a", value: "1", domain: "x.com", path: "/", sameSite: "None" },
      ]),
    ).toThrow(/sameSite: "None" without secure: true/);
  });

  it("does NOT throw when sameSite is None and secure is true", () => {
    const result = normalizeCookieParams([
      {
        name: "a",
        value: "1",
        domain: "x.com",
        path: "/",
        sameSite: "None",
        secure: true,
      },
    ]);
    expect(result[0]!.sameSite).toBe("None");
    expect(result[0]!.secure).toBe(true);
  });

  it("derives root path from URL with no trailing path segments", () => {
    const result = normalizeCookieParams([
      { name: "a", value: "1", url: "https://example.com" },
    ]);
    // URL("https://example.com").pathname is "/", lastIndexOf("/") + 1 = 1 → "/"
    expect(result[0]!.path).toBe("/");
  });

  it("handles URL with port number", () => {
    const result = normalizeCookieParams([
      { name: "a", value: "1", url: "https://localhost:3000/api/v1" },
    ]);
    expect(result[0]!.domain).toBe("localhost");
    expect(result[0]!.path).toBe("/api/");
    expect(result[0]!.secure).toBe(true);
  });

  it("handles URL with query string (ignores query)", () => {
    const result = normalizeCookieParams([
      { name: "a", value: "1", url: "https://example.com/page?q=1" },
    ]);
    expect(result[0]!.domain).toBe("example.com");
    expect(result[0]!.path).toBe("/");
  });

  it("normalises multiple cookies in a single call", () => {
    const result = normalizeCookieParams([
      { name: "a", value: "1", url: "https://one.com/x" },
      { name: "b", value: "2", domain: "two.com", path: "/" },
      { name: "c", value: "3", url: "http://three.com/y/z" },
    ]);
    expect(result).toHaveLength(3);
    expect(result[0]!.domain).toBe("one.com");
    expect(result[1]!.domain).toBe("two.com");
    expect(result[2]!.domain).toBe("three.com");
    expect(result[2]!.secure).toBe(false);
  });

  it("does not mutate the original input array", () => {
    const input: CookieParam[] = [
      { name: "a", value: "1", url: "https://example.com/app" },
    ];
    const frozen = { ...input[0]! };
    normalizeCookieParams(input);
    expect(input[0]).toEqual(frozen);
  });

  it("preserves optional fields that are explicitly set", () => {
    const result = normalizeCookieParams([
      {
        name: "full",
        value: "val",
        domain: "x.com",
        path: "/p",
        expires: 9999999999,
        httpOnly: true,
        secure: true,
        sameSite: "Strict",
      },
    ]);
    const c = result[0]!;
    expect(c.httpOnly).toBe(true);
    expect(c.secure).toBe(true);
    expect(c.sameSite).toBe("Strict");
    expect(c.expires).toBe(9999999999);
  });

  it("allows expires of 0 (epoch — effectively expired)", () => {
    // 0 is a positive-ish edge case; browsers treat it as already expired
    const result = normalizeCookieParams([
      { name: "a", value: "1", domain: "x.com", path: "/", expires: 0 },
    ]);
    expect(result[0]!.expires).toBe(0);
  });

  it("throws on the first invalid cookie in a batch", () => {
    expect(() =>
      normalizeCookieParams([
        { name: "ok", value: "1", domain: "x.com", path: "/" },
        { name: "bad", value: "2" }, // missing url/domain+path
      ]),
    ).toThrow(/Cookie "bad"/);
  });

  it("includes cookie name in every error message", () => {
    const cases = [
      () => normalizeCookieParams([{ name: "NAMED", value: "1" }]),
      () =>
        normalizeCookieParams([
          { name: "NAMED", value: "1", url: "https://x.com/", domain: "x" },
        ]),
      () =>
        normalizeCookieParams([
          { name: "NAMED", value: "1", url: "about:blank" },
        ]),
      () =>
        normalizeCookieParams([
          {
            name: "NAMED",
            value: "1",
            domain: "x.com",
            path: "/",
            sameSite: "None",
            secure: false,
          },
        ]),
    ];
    for (const fn of cases) {
      expect(fn).toThrow(/NAMED/);
    }
  });
});

describe("cookieMatchesFilter", () => {
  const cookie = makeCookie({
    name: "session",
    domain: ".example.com",
    path: "/app",
  });

  it("matches when all filters match (exact strings)", () => {
    expect(
      cookieMatchesFilter(cookie, {
        name: "session",
        domain: ".example.com",
        path: "/app",
      }),
    ).toBe(true);
  });

  it("does not match when name differs", () => {
    expect(cookieMatchesFilter(cookie, { name: "other" })).toBe(false);
  });

  it("does not match when domain differs", () => {
    expect(cookieMatchesFilter(cookie, { domain: "other.com" })).toBe(false);
  });

  it("does not match when path differs", () => {
    expect(cookieMatchesFilter(cookie, { path: "/other" })).toBe(false);
  });

  it("matches with regex name", () => {
    expect(cookieMatchesFilter(cookie, { name: /^sess/ })).toBe(true);
    expect(cookieMatchesFilter(cookie, { name: /^nope/ })).toBe(false);
  });

  it("matches with regex domain", () => {
    expect(cookieMatchesFilter(cookie, { domain: /example\.com$/ })).toBe(true);
    expect(cookieMatchesFilter(cookie, { domain: /^other/ })).toBe(false);
  });

  it("matches with regex path", () => {
    expect(cookieMatchesFilter(cookie, { path: /^\/app/ })).toBe(true);
  });

  it("undefined filters match everything", () => {
    expect(cookieMatchesFilter(cookie, {})).toBe(true);
    expect(cookieMatchesFilter(cookie, { name: undefined })).toBe(true);
  });

  it("requires ALL filters to match (AND logic)", () => {
    // name matches but domain does not
    expect(
      cookieMatchesFilter(cookie, { name: "session", domain: "wrong.com" }),
    ).toBe(false);
  });

  it("handles global regex lastIndex correctly", () => {
    const re = /sess/g;
    re.lastIndex = 999;
    expect(cookieMatchesFilter(cookie, { name: re })).toBe(true);
  });

  it("exact string does not do substring matching", () => {
    // filter name "sess" should NOT match cookie name "session"
    expect(cookieMatchesFilter(cookie, { name: "sess" })).toBe(false);
  });

  it("regex can do substring matching", () => {
    // regex /sess/ SHOULD match cookie name "session" (substring)
    expect(cookieMatchesFilter(cookie, { name: /sess/ })).toBe(true);
  });

  it("works with all three regex filters combined", () => {
    expect(
      cookieMatchesFilter(cookie, {
        name: /^session$/,
        domain: /example/,
        path: /^\/app$/,
      }),
    ).toBe(true);

    // One of three fails
    expect(
      cookieMatchesFilter(cookie, {
        name: /^session$/,
        domain: /example/,
        path: /^\/wrong$/,
      }),
    ).toBe(false);
  });

  it("empty string filter only matches empty cookie property", () => {
    const emptyPathCookie = makeCookie({
      name: "x",
      domain: "a.com",
      path: "",
    });
    expect(cookieMatchesFilter(emptyPathCookie, { path: "" })).toBe(true);
    expect(cookieMatchesFilter(cookie, { path: "" })).toBe(false);
  });

  it("is called once per cookie (no cross-contamination between calls)", () => {
    const c1 = makeCookie({ name: "alpha", domain: "a.com", path: "/" });
    const c2 = makeCookie({ name: "beta", domain: "b.com", path: "/x" });
    const filter = { name: "alpha", domain: "a.com" };
    expect(cookieMatchesFilter(c1, filter)).toBe(true);
    expect(cookieMatchesFilter(c2, filter)).toBe(false);
  });
});

describe("V3Context cookie methods", () => {
  // We test V3Context methods by constructing a minimal instance with a mock
  // CDP connection. V3Context.create() requires a real WebSocket, so we build
  // one via type-casting a MockCDPSession into the `conn` slot.

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let V3ContextClass: { prototype: V3Context } & Record<string, any>;

  beforeEach(async () => {
    const mod = await import("../../lib/v3/understudy/context");
    V3ContextClass = mod.V3Context as typeof V3ContextClass;
  });

  function makeContext(
    cdpHandlers: Record<string, (params?: Record<string, unknown>) => unknown>,
  ): V3Context {
    const mockConn = new MockCDPSession(cdpHandlers, "root");
    // V3Context stores the connection as `conn` (readonly). We create an
    // object with the real prototype so we get the actual method implementations.
    const ctx = Object.create(V3ContextClass.prototype) as V3Context & {
      conn: MockCDPSession;
    };
    // Assign the mock connection
    Object.defineProperty(ctx, "conn", { value: mockConn, writable: false });
    return ctx;
  }

  function getMockConn(ctx: V3Context): MockCDPSession {
    return (ctx as unknown as { conn: MockCDPSession }).conn;
  }

  describe("cookies()", () => {
    it("returns all cookies from Storage.getCookies", async () => {
      const cdpCookies = [
        toCdpCookie(makeCookie({ name: "a", domain: "example.com" })),
        toCdpCookie(makeCookie({ name: "b", domain: "other.com" })),
      ];
      const ctx = makeContext({
        "Storage.getCookies": () => ({ cookies: cdpCookies }),
      });

      const result = await ctx.cookies();
      expect(result).toHaveLength(2);
      expect(result.map((c) => c.name)).toEqual(["a", "b"]);
    });

    it("filters by URL when provided as string", async () => {
      const cdpCookies = [
        toCdpCookie(makeCookie({ name: "a", domain: "example.com" })),
        toCdpCookie(makeCookie({ name: "b", domain: "other.com" })),
      ];
      const ctx = makeContext({
        "Storage.getCookies": () => ({ cookies: cdpCookies }),
      });

      const result = await ctx.cookies("http://example.com/");
      expect(result).toHaveLength(1);
      expect(result[0]!.name).toBe("a");
    });

    it("filters by URL when provided as array", async () => {
      const cdpCookies = [
        toCdpCookie(makeCookie({ name: "a", domain: "example.com" })),
        toCdpCookie(makeCookie({ name: "b", domain: "other.com" })),
      ];
      const ctx = makeContext({
        "Storage.getCookies": () => ({ cookies: cdpCookies }),
      });

      const result = await ctx.cookies(["http://other.com/"]);
      expect(result).toHaveLength(1);
      expect(result[0]!.name).toBe("b");
    });

    it("defaults sameSite to Lax when CDP returns undefined", async () => {
      const cdpCookie = {
        ...toCdpCookie(makeCookie()),
        sameSite: undefined as string | undefined,
      };
      const ctx = makeContext({
        "Storage.getCookies": () => ({ cookies: [cdpCookie] }),
      });

      const result = await ctx.cookies();
      expect(result[0]!.sameSite).toBe("Lax");
    });

    it("returns empty array when browser has no cookies", async () => {
      const ctx = makeContext({
        "Storage.getCookies": () => ({ cookies: [] }),
      });
      const result = await ctx.cookies();
      expect(result).toEqual([]);
    });

    it("maps all CDP cookie fields to our Cookie type", async () => {
      const cdpCookie = toCdpCookie(
        makeCookie({
          name: "full",
          value: "v",
          domain: ".test.com",
          path: "/p",
          expires: 1700000000,
          httpOnly: true,
          secure: true,
          sameSite: "Strict",
        }),
      );
      const ctx = makeContext({
        "Storage.getCookies": () => ({ cookies: [cdpCookie] }),
      });

      const result = await ctx.cookies();
      expect(result[0]).toEqual({
        name: "full",
        value: "v",
        domain: ".test.com",
        path: "/p",
        expires: 1700000000,
        httpOnly: true,
        secure: true,
        sameSite: "Strict",
      });
    });

    it("strips extra CDP fields (size, priority, etc.) from result", async () => {
      const cdpCookie = toCdpCookie(makeCookie({ name: "stripped" }));
      const ctx = makeContext({
        "Storage.getCookies": () => ({ cookies: [cdpCookie] }),
      });

      const result = await ctx.cookies();
      const keys = Object.keys(result[0]!);
      expect(keys).not.toContain("size");
      expect(keys).not.toContain("priority");
      expect(keys).not.toContain("sourceScheme");
      expect(keys).not.toContain("sourcePort");
    });

    it("calls Storage.getCookies exactly once per invocation", async () => {
      const ctx = makeContext({
        "Storage.getCookies": () => ({ cookies: [] }),
      });

      await ctx.cookies();
      await ctx.cookies("http://example.com");

      const calls = getMockConn(ctx).callsFor("Storage.getCookies");
      expect(calls).toHaveLength(2);
    });
  });

  describe("addCookies()", () => {
    it("sends all cookies in a single Storage.setCookies call", async () => {
      const ctx = makeContext({
        "Storage.setCookies": () => ({}),
      });

      await ctx.addCookies([
        { name: "a", value: "1", domain: "example.com", path: "/" },
        { name: "b", value: "2", domain: "other.com", path: "/" },
      ]);

      const calls = getMockConn(ctx).callsFor("Storage.setCookies");
      expect(calls).toHaveLength(1);
      expect(calls[0]!.params).toMatchObject({
        cookies: [
          { name: "a", domain: "example.com" },
          { name: "b", domain: "other.com" },
        ],
      });
    });

    it("derives domain/path/secure from url", async () => {
      const ctx = makeContext({
        "Storage.setCookies": () => ({}),
      });

      await ctx.addCookies([
        { name: "a", value: "1", url: "https://example.com/app/page" },
      ]);

      const calls = getMockConn(ctx).callsFor("Storage.setCookies");
      expect(calls[0]!.params).toMatchObject({
        cookies: [
          { name: "a", domain: "example.com", path: "/app/", secure: true },
        ],
      });
    });

    it("throws when Storage.setCookies fails", async () => {
      const ctx = makeContext({
        "Storage.setCookies": () => {
          throw new Error("CDP failure");
        },
      });

      await expect(
        ctx.addCookies([
          { name: "bad", value: "x", domain: "example.com", path: "/" },
        ]),
      ).rejects.toThrow(/Failed to set cookies \["bad"\]/);
    });

    it("throws for sameSite None without secure", async () => {
      const ctx = makeContext({
        "Storage.setCookies": () => ({}),
      });

      await expect(
        ctx.addCookies([
          {
            name: "x",
            value: "1",
            domain: "example.com",
            path: "/",
            sameSite: "None",
            secure: false,
          },
        ]),
      ).rejects.toThrow(/sameSite: "None" without secure: true/);
    });

    it("does nothing when passed an empty array", async () => {
      const ctx = makeContext({
        "Storage.setCookies": () => ({}),
      });

      await ctx.addCookies([]);

      const calls = getMockConn(ctx).callsFor("Storage.setCookies");
      expect(calls).toHaveLength(0);
    });

    it("sends all cookie fields to CDP (including optional ones)", async () => {
      const ctx = makeContext({
        "Storage.setCookies": () => ({}),
      });

      await ctx.addCookies([
        {
          name: "full",
          value: "val",
          domain: "x.com",
          path: "/p",
          expires: 9999999999,
          httpOnly: true,
          secure: true,
          sameSite: "Strict",
        },
      ]);

      const calls = getMockConn(ctx).callsFor("Storage.setCookies");
      expect(calls[0]!.params).toEqual({
        cookies: [
          {
            name: "full",
            value: "val",
            domain: "x.com",
            path: "/p",
            expires: 9999999999,
            httpOnly: true,
            secure: true,
            sameSite: "Strict",
          },
        ],
      });
    });

    it("error message includes all cookie names when batch fails", async () => {
      const ctx = makeContext({
        "Storage.setCookies": () => {
          throw new Error("CDP failure");
        },
      });

      await expect(
        ctx.addCookies([
          { name: "alpha", value: "1", domain: "a.com", path: "/" },
          { name: "beta", value: "2", domain: "b.com", path: "/" },
        ]),
      ).rejects.toThrow(/Failed to set cookies \["alpha", "beta"\]/);
    });
  });

  describe("clearCookies()", () => {
    const cdpCookies = [
      toCdpCookie(
        makeCookie({ name: "session", domain: "example.com", path: "/" }),
      ),
      toCdpCookie(
        makeCookie({ name: "_ga", domain: ".example.com", path: "/" }),
      ),
      toCdpCookie(
        makeCookie({ name: "pref", domain: "other.com", path: "/settings" }),
      ),
    ];

    it("uses atomic Storage.clearCookies when called with no options", async () => {
      const ctx = makeContext({
        "Storage.clearCookies": () => ({}),
      });

      await ctx.clearCookies();

      const clearCalls = getMockConn(ctx).callsFor("Storage.clearCookies");
      expect(clearCalls).toHaveLength(1);

      // Should NOT have fetched or re-set anything
      const getCalls = getMockConn(ctx).callsFor("Storage.getCookies");
      expect(getCalls).toHaveLength(0);
      const setCalls = getMockConn(ctx).callsFor("Storage.setCookies");
      expect(setCalls).toHaveLength(0);
    });

    it("clears and re-adds only non-matching cookies (name filter)", async () => {
      const ctx = makeContext({
        "Storage.getCookies": () => ({ cookies: [...cdpCookies] }),
        "Storage.clearCookies": () => ({}),
        "Storage.setCookies": () => ({}),
      });

      await ctx.clearCookies({ name: "_ga" });

      const clearCalls = getMockConn(ctx).callsFor("Storage.clearCookies");
      expect(clearCalls).toHaveLength(1);

      const setCalls = getMockConn(ctx).callsFor("Storage.setCookies");
      expect(setCalls).toHaveLength(1);
      const kept = (
        setCalls[0]!.params?.cookies as Array<{ name: string }>
      ).map((c) => c.name);
      expect(kept).toEqual(["session", "pref"]);
    });

    it("clears and re-adds only non-matching cookies (domain filter)", async () => {
      const ctx = makeContext({
        "Storage.getCookies": () => ({ cookies: [...cdpCookies] }),
        "Storage.clearCookies": () => ({}),
        "Storage.setCookies": () => ({}),
      });

      await ctx.clearCookies({ domain: "other.com" });

      const setCalls = getMockConn(ctx).callsFor("Storage.setCookies");
      const kept = (
        setCalls[0]!.params?.cookies as Array<{ name: string }>
      ).map((c) => c.name);
      expect(kept).toEqual(["session", "_ga"]);
    });

    it("clears and re-adds only non-matching cookies (regex name)", async () => {
      const ctx = makeContext({
        "Storage.getCookies": () => ({ cookies: [...cdpCookies] }),
        "Storage.clearCookies": () => ({}),
        "Storage.setCookies": () => ({}),
      });

      await ctx.clearCookies({ name: /^_ga/ });

      const setCalls = getMockConn(ctx).callsFor("Storage.setCookies");
      const kept = (
        setCalls[0]!.params?.cookies as Array<{ name: string }>
      ).map((c) => c.name);
      expect(kept).toEqual(["session", "pref"]);
    });

    it("applies AND logic across multiple filters", async () => {
      const ctx = makeContext({
        "Storage.getCookies": () => ({ cookies: [...cdpCookies] }),
        "Storage.clearCookies": () => ({}),
        "Storage.setCookies": () => ({}),
      });

      await ctx.clearCookies({ name: "session", domain: "example.com" });

      const setCalls = getMockConn(ctx).callsFor("Storage.setCookies");
      const kept = (
        setCalls[0]!.params?.cookies as Array<{ name: string }>
      ).map((c) => c.name);
      expect(kept).toEqual(["_ga", "pref"]);
    });

    it("does nothing when filter matches no cookies", async () => {
      const ctx = makeContext({
        "Storage.getCookies": () => ({ cookies: [...cdpCookies] }),
        "Storage.clearCookies": () => ({}),
        "Storage.setCookies": () => ({}),
      });

      await ctx.clearCookies({ name: "nonexistent" });

      const clearCalls = getMockConn(ctx).callsFor("Storage.clearCookies");
      expect(clearCalls).toHaveLength(0);
      const setCalls = getMockConn(ctx).callsFor("Storage.setCookies");
      expect(setCalls).toHaveLength(0);
    });

    it("clears without re-adding when filter matches all cookies", async () => {
      const ctx = makeContext({
        "Storage.getCookies": () => ({ cookies: [...cdpCookies] }),
        "Storage.clearCookies": () => ({}),
        "Storage.setCookies": () => ({}),
      });

      await ctx.clearCookies({ name: /.*/ });

      const clearCalls = getMockConn(ctx).callsFor("Storage.clearCookies");
      expect(clearCalls).toHaveLength(1);
      const setCalls = getMockConn(ctx).callsFor("Storage.setCookies");
      expect(setCalls).toHaveLength(0);
    });

    it("handles regex that matches multiple cookies", async () => {
      const ctx = makeContext({
        "Storage.getCookies": () => ({
          cookies: [
            toCdpCookie(
              makeCookie({ name: "_ga_ABC", domain: "example.com", path: "/" }),
            ),
            toCdpCookie(
              makeCookie({ name: "_ga_DEF", domain: "example.com", path: "/" }),
            ),
            toCdpCookie(
              makeCookie({ name: "_gid", domain: "example.com", path: "/" }),
            ),
            toCdpCookie(
              makeCookie({ name: "session", domain: "example.com", path: "/" }),
            ),
          ],
        }),
        "Storage.clearCookies": () => ({}),
        "Storage.setCookies": () => ({}),
      });

      await ctx.clearCookies({ name: /^_ga/ });

      const setCalls = getMockConn(ctx).callsFor("Storage.setCookies");
      const kept = (
        setCalls[0]!.params?.cookies as Array<{ name: string }>
      ).map((c) => c.name);
      expect(kept).toContain("_gid");
      expect(kept).toContain("session");
      expect(kept).not.toContain("_ga_ABC");
      expect(kept).not.toContain("_ga_DEF");
    });

    it("regex domain filter combined with path filter", async () => {
      const ctx = makeContext({
        "Storage.getCookies": () => ({ cookies: [...cdpCookies] }),
        "Storage.clearCookies": () => ({}),
        "Storage.setCookies": () => ({}),
      });

      await ctx.clearCookies({ domain: /example/, path: "/settings" });

      const clearCalls = getMockConn(ctx).callsFor("Storage.clearCookies");
      expect(clearCalls).toHaveLength(0);
      const setCalls = getMockConn(ctx).callsFor("Storage.setCookies");
      expect(setCalls).toHaveLength(0);
    });

    it("clearCookies with empty options object uses atomic clear (same as no args)", async () => {
      const ctx = makeContext({
        "Storage.clearCookies": () => ({}),
      });

      await ctx.clearCookies({});

      const clearCalls = getMockConn(ctx).callsFor("Storage.clearCookies");
      expect(clearCalls).toHaveLength(1);
    });

    it("clears and re-adds only non-matching cookies (path filter)", async () => {
      const ctx = makeContext({
        "Storage.getCookies": () => ({ cookies: [...cdpCookies] }),
        "Storage.clearCookies": () => ({}),
        "Storage.setCookies": () => ({}),
      });

      await ctx.clearCookies({ path: "/settings" });

      const clearCalls = getMockConn(ctx).callsFor("Storage.clearCookies");
      expect(clearCalls).toHaveLength(1);

      const setCalls = getMockConn(ctx).callsFor("Storage.setCookies");
      expect(setCalls).toHaveLength(1);
      const kept = (
        setCalls[0]!.params?.cookies as Array<{ name: string }>
      ).map((c) => c.name);
      expect(kept).toEqual(["session", "_ga"]);
      expect(kept).not.toContain("pref");
    });

    it("throws when Storage.getCookies fails during filtered clear", async () => {
      const ctx = makeContext({
        "Storage.getCookies": () => {
          throw new Error("CDP getCookies failure");
        },
        "Storage.clearCookies": () => ({}),
        "Storage.setCookies": () => ({}),
      });

      await expect(ctx.clearCookies({ name: "session" })).rejects.toThrow(
        /CDP getCookies failure/,
      );

      // clearCookies and setCookies should never have been called
      const clearCalls = getMockConn(ctx).callsFor("Storage.clearCookies");
      expect(clearCalls).toHaveLength(0);
      const setCalls = getMockConn(ctx).callsFor("Storage.setCookies");
      expect(setCalls).toHaveLength(0);
    });

    it("throws when Storage.clearCookies fails during filtered clear", async () => {
      const ctx = makeContext({
        "Storage.getCookies": () => ({ cookies: [...cdpCookies] }),
        "Storage.clearCookies": () => {
          throw new Error("CDP clearCookies failure");
        },
        "Storage.setCookies": () => ({}),
      });

      await expect(ctx.clearCookies({ name: "session" })).rejects.toThrow(
        /CDP clearCookies failure/,
      );

      // setCookies should never have been called — cookies are untouched
      const setCalls = getMockConn(ctx).callsFor("Storage.setCookies");
      expect(setCalls).toHaveLength(0);
    });

    it("throws when Storage.setCookies fails during re-add, cookies are already wiped", async () => {
      const ctx = makeContext({
        "Storage.getCookies": () => ({ cookies: [...cdpCookies] }),
        "Storage.clearCookies": () => ({}),
        "Storage.setCookies": () => {
          throw new Error("CDP setCookies failure");
        },
      });

      await expect(ctx.clearCookies({ name: "session" })).rejects.toThrow(
        /cookie jar is now empty/,
      );

      // clearCookies WAS called — cookies are gone
      const clearCalls = getMockConn(ctx).callsFor("Storage.clearCookies");
      expect(clearCalls).toHaveLength(1);
    });
  });

  describe("cookies() sameSite mapping", () => {
    it("passes through valid sameSite values as-is", async () => {
      for (const sameSite of ["Strict", "Lax", "None"] as const) {
        const cdpCookie = { ...toCdpCookie(makeCookie()), sameSite };
        const ctx = makeContext({
          "Storage.getCookies": () => ({ cookies: [cdpCookie] }),
        });
        const result = await ctx.cookies();
        expect(result[0]!.sameSite).toBe(sameSite);
      }
    });

    it("does not normalize lowercase sameSite values from CDP", async () => {
      // CDP may return lowercase values; the current implementation casts
      // without normalizing, so "none" passes through as-is.
      const cdpCookie = { ...toCdpCookie(makeCookie()), sameSite: "none" };
      const ctx = makeContext({
        "Storage.getCookies": () => ({ cookies: [cdpCookie] }),
      });
      const result = await ctx.cookies();
      // This documents the current behavior: lowercase is NOT normalized.
      expect(result[0]!.sameSite).toBe("none");
    });
  });
});

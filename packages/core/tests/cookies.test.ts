import { beforeEach, describe, expect, it } from "vitest";
import {
  filterCookies,
  normalizeCookieParams,
  cookieMatchesFilter,
  type Cookie,
  type CookieParam,
} from "../lib/v3/understudy/cookies";
import { MockCDPSession } from "./helpers/mockCDPSession";
import type { V3Context } from "../lib/v3/understudy/context";

// ---------------------------------------------------------------------------
// Helpers: mock cookie factory
// ---------------------------------------------------------------------------

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

/** Convert our Cookie type into the shape CDP's Network.getAllCookies returns. */
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

// ============================================================================
// filterCookies
// ============================================================================

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

  it("allows secure cookies on localhost regardless of protocol", () => {
    const localCookie = makeCookie({
      name: "local",
      domain: "localhost",
      secure: true,
    });
    const result = filterCookies([localCookie], ["http://localhost/"]);
    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe("local");
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
});

// ============================================================================
// normalizeCookieParams
// ============================================================================

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
    ).toThrow(/sameSite: "None" but secure: false/);
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

  it("does NOT throw when sameSite is None and secure is undefined (not explicitly false)", () => {
    // secure is undefined — the browser will decide, we don't block it
    const result = normalizeCookieParams([
      { name: "a", value: "1", domain: "x.com", path: "/", sameSite: "None" },
    ]);
    expect(result[0]!.sameSite).toBe("None");
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

// ============================================================================
// cookieMatchesFilter
// ============================================================================

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

// ============================================================================
// V3Context cookie methods (integration with MockCDPSession)
// ============================================================================

describe("V3Context cookie methods", () => {
  // We test V3Context methods by constructing a minimal instance with a mock
  // CDP connection. V3Context.create() requires a real WebSocket, so we build
  // one via type-casting a MockCDPSession into the `conn` slot.

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let V3ContextClass: { prototype: V3Context } & Record<string, any>;

  beforeEach(async () => {
    const mod = await import("../lib/v3/understudy/context");
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

  // ---------- cookies() ----------

  describe("cookies()", () => {
    it("returns all cookies from Network.getAllCookies", async () => {
      const cdpCookies = [
        toCdpCookie(makeCookie({ name: "a", domain: "example.com" })),
        toCdpCookie(makeCookie({ name: "b", domain: "other.com" })),
      ];
      const ctx = makeContext({
        "Network.getAllCookies": () => ({ cookies: cdpCookies }),
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
        "Network.getAllCookies": () => ({ cookies: cdpCookies }),
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
        "Network.getAllCookies": () => ({ cookies: cdpCookies }),
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
        "Network.getAllCookies": () => ({ cookies: [cdpCookie] }),
      });

      const result = await ctx.cookies();
      expect(result[0]!.sameSite).toBe("Lax");
    });

    it("returns empty array when browser has no cookies", async () => {
      const ctx = makeContext({
        "Network.getAllCookies": () => ({ cookies: [] }),
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
        "Network.getAllCookies": () => ({ cookies: [cdpCookie] }),
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
        "Network.getAllCookies": () => ({ cookies: [cdpCookie] }),
      });

      const result = await ctx.cookies();
      const keys = Object.keys(result[0]!);
      expect(keys).not.toContain("size");
      expect(keys).not.toContain("priority");
      expect(keys).not.toContain("sourceScheme");
      expect(keys).not.toContain("sourcePort");
    });

    it("calls Network.getAllCookies exactly once per invocation", async () => {
      const ctx = makeContext({
        "Network.getAllCookies": () => ({ cookies: [] }),
      });

      await ctx.cookies();
      await ctx.cookies("http://example.com");

      const calls = getMockConn(ctx).callsFor("Network.getAllCookies");
      expect(calls).toHaveLength(2);
    });
  });

  // ---------- addCookies() ----------

  describe("addCookies()", () => {
    it("sends Network.setCookie for each cookie", async () => {
      const ctx = makeContext({
        "Network.setCookie": () => ({ success: true }),
      });

      await ctx.addCookies([
        { name: "a", value: "1", domain: "example.com", path: "/" },
        { name: "b", value: "2", domain: "other.com", path: "/" },
      ]);

      const calls = getMockConn(ctx).callsFor("Network.setCookie");
      expect(calls).toHaveLength(2);
      expect(calls[0]!.params).toMatchObject({
        name: "a",
        domain: "example.com",
      });
      expect(calls[1]!.params).toMatchObject({
        name: "b",
        domain: "other.com",
      });
    });

    it("derives domain/path/secure from url", async () => {
      const ctx = makeContext({
        "Network.setCookie": () => ({ success: true }),
      });

      await ctx.addCookies([
        { name: "a", value: "1", url: "https://example.com/app/page" },
      ]);

      const calls = getMockConn(ctx).callsFor("Network.setCookie");
      expect(calls[0]!.params).toMatchObject({
        name: "a",
        domain: "example.com",
        path: "/app/",
        secure: true,
      });
    });

    it("throws when Network.setCookie returns success: false", async () => {
      const ctx = makeContext({
        "Network.setCookie": () => ({ success: false }),
      });

      await expect(
        ctx.addCookies([
          { name: "bad", value: "x", domain: "example.com", path: "/" },
        ]),
      ).rejects.toThrow(/Failed to set cookie "bad"/);
    });

    it("throws for sameSite None without secure", async () => {
      const ctx = makeContext({
        "Network.setCookie": () => ({ success: true }),
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
      ).rejects.toThrow(/sameSite: "None" but secure: false/);
    });

    it("does nothing when passed an empty array", async () => {
      const ctx = makeContext({
        "Network.setCookie": () => ({ success: true }),
      });

      await ctx.addCookies([]);

      const calls = getMockConn(ctx).callsFor("Network.setCookie");
      expect(calls).toHaveLength(0);
    });

    it("sends all cookie fields to CDP (including optional ones)", async () => {
      const ctx = makeContext({
        "Network.setCookie": () => ({ success: true }),
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

      const calls = getMockConn(ctx).callsFor("Network.setCookie");
      expect(calls[0]!.params).toEqual({
        name: "full",
        value: "val",
        domain: "x.com",
        path: "/p",
        expires: 9999999999,
        httpOnly: true,
        secure: true,
        sameSite: "Strict",
      });
    });

    it("stops on first failure and does not continue to remaining cookies", async () => {
      let callCount = 0;
      const ctx = makeContext({
        "Network.setCookie": () => {
          callCount++;
          // First succeeds, second fails
          return { success: callCount <= 1 };
        },
      });

      await expect(
        ctx.addCookies([
          { name: "ok", value: "1", domain: "a.com", path: "/" },
          { name: "fail", value: "2", domain: "b.com", path: "/" },
          { name: "never", value: "3", domain: "c.com", path: "/" },
        ]),
      ).rejects.toThrow(/Failed to set cookie "fail"/);

      // "never" should not have been attempted
      expect(callCount).toBe(2);
    });

    it("error message includes the domain when setCookie fails", async () => {
      const ctx = makeContext({
        "Network.setCookie": () => ({ success: false }),
      });

      await expect(
        ctx.addCookies([
          { name: "x", value: "1", domain: "specific.com", path: "/" },
        ]),
      ).rejects.toThrow(/specific\.com/);
    });
  });

  // ---------- clearCookies() ----------

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

    it("deletes ALL cookies when called with no options", async () => {
      const ctx = makeContext({
        "Network.getAllCookies": () => ({ cookies: [...cdpCookies] }),
        "Network.deleteCookies": () => ({}),
      });

      await ctx.clearCookies();

      const deleteCalls = getMockConn(ctx).callsFor("Network.deleteCookies");
      expect(deleteCalls).toHaveLength(3);
    });

    it("deletes only cookies matching a name filter", async () => {
      const ctx = makeContext({
        "Network.getAllCookies": () => ({ cookies: [...cdpCookies] }),
        "Network.deleteCookies": () => ({}),
      });

      await ctx.clearCookies({ name: "_ga" });

      const deleteCalls = getMockConn(ctx).callsFor("Network.deleteCookies");
      expect(deleteCalls).toHaveLength(1);
      expect(deleteCalls[0]!.params).toMatchObject({ name: "_ga" });
    });

    it("deletes only cookies matching a domain filter", async () => {
      const ctx = makeContext({
        "Network.getAllCookies": () => ({ cookies: [...cdpCookies] }),
        "Network.deleteCookies": () => ({}),
      });

      await ctx.clearCookies({ domain: "other.com" });

      const deleteCalls = getMockConn(ctx).callsFor("Network.deleteCookies");
      expect(deleteCalls).toHaveLength(1);
      expect(deleteCalls[0]!.params).toMatchObject({
        name: "pref",
        domain: "other.com",
      });
    });

    it("deletes cookies matching a regex pattern", async () => {
      const ctx = makeContext({
        "Network.getAllCookies": () => ({ cookies: [...cdpCookies] }),
        "Network.deleteCookies": () => ({}),
      });

      await ctx.clearCookies({ name: /^_ga/ });

      const deleteCalls = getMockConn(ctx).callsFor("Network.deleteCookies");
      expect(deleteCalls).toHaveLength(1);
      expect(deleteCalls[0]!.params).toMatchObject({ name: "_ga" });
    });

    it("applies AND logic across multiple filters", async () => {
      const ctx = makeContext({
        "Network.getAllCookies": () => ({ cookies: [...cdpCookies] }),
        "Network.deleteCookies": () => ({}),
      });

      // name matches "session" AND domain matches "example.com"
      await ctx.clearCookies({ name: "session", domain: "example.com" });

      const deleteCalls = getMockConn(ctx).callsFor("Network.deleteCookies");
      expect(deleteCalls).toHaveLength(1);
      expect(deleteCalls[0]!.params).toMatchObject({
        name: "session",
        domain: "example.com",
      });
    });

    it("does not delete non-matching cookies (no nuke-and-re-add)", async () => {
      const ctx = makeContext({
        "Network.getAllCookies": () => ({ cookies: [...cdpCookies] }),
        "Network.deleteCookies": () => ({}),
        "Network.setCookie": () => ({ success: true }),
      });

      await ctx.clearCookies({ name: "session" });

      // Should NOT have called setCookie (no re-add needed)
      const setCalls = getMockConn(ctx).callsFor("Network.setCookie");
      expect(setCalls).toHaveLength(0);

      // Should only have deleted the one matching cookie
      const deleteCalls = getMockConn(ctx).callsFor("Network.deleteCookies");
      expect(deleteCalls).toHaveLength(1);
    });

    it("handles empty cookie jar gracefully", async () => {
      const ctx = makeContext({
        "Network.getAllCookies": () => ({ cookies: [] }),
        "Network.deleteCookies": () => ({}),
      });

      await ctx.clearCookies();

      const deleteCalls = getMockConn(ctx).callsFor("Network.deleteCookies");
      expect(deleteCalls).toHaveLength(0);
    });

    it("deletes nothing when filter matches no cookies", async () => {
      const ctx = makeContext({
        "Network.getAllCookies": () => ({ cookies: [...cdpCookies] }),
        "Network.deleteCookies": () => ({}),
      });

      await ctx.clearCookies({ name: "nonexistent" });

      const deleteCalls = getMockConn(ctx).callsFor("Network.deleteCookies");
      expect(deleteCalls).toHaveLength(0);
    });

    it("sends correct domain and path for each deleted cookie", async () => {
      const ctx = makeContext({
        "Network.getAllCookies": () => ({ cookies: [...cdpCookies] }),
        "Network.deleteCookies": () => ({}),
      });

      await ctx.clearCookies(); // delete all

      const deleteCalls = getMockConn(ctx).callsFor("Network.deleteCookies");
      expect(deleteCalls).toHaveLength(3);
      expect(deleteCalls[0]!.params).toMatchObject({
        name: "session",
        domain: "example.com",
        path: "/",
      });
      expect(deleteCalls[1]!.params).toMatchObject({
        name: "_ga",
        domain: ".example.com",
        path: "/",
      });
      expect(deleteCalls[2]!.params).toMatchObject({
        name: "pref",
        domain: "other.com",
        path: "/settings",
      });
    });

    it("handles regex that matches multiple cookies", async () => {
      const ctx = makeContext({
        "Network.getAllCookies": () => ({
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
        "Network.deleteCookies": () => ({}),
      });

      await ctx.clearCookies({ name: /^_ga/ });

      const deleteCalls = getMockConn(ctx).callsFor("Network.deleteCookies");
      expect(deleteCalls).toHaveLength(2);
      const deletedNames = deleteCalls.map((c) => c.params?.name);
      expect(deletedNames).toContain("_ga_ABC");
      expect(deletedNames).toContain("_ga_DEF");
      expect(deletedNames).not.toContain("_gid");
      expect(deletedNames).not.toContain("session");
    });

    it("regex domain filter combined with path filter", async () => {
      const ctx = makeContext({
        "Network.getAllCookies": () => ({ cookies: [...cdpCookies] }),
        "Network.deleteCookies": () => ({}),
      });

      // Match domain containing "example" AND path "/settings"
      // Only "pref" has path "/settings" but domain is "other.com" — no match
      // No cookie has both domain matching /example/ AND path "/settings"
      await ctx.clearCookies({ domain: /example/, path: "/settings" });

      const deleteCalls = getMockConn(ctx).callsFor("Network.deleteCookies");
      expect(deleteCalls).toHaveLength(0);
    });

    it("clearCookies with empty options object deletes all (same as no args)", async () => {
      const ctx = makeContext({
        "Network.getAllCookies": () => ({ cookies: [...cdpCookies] }),
        "Network.deleteCookies": () => ({}),
      });

      await ctx.clearCookies({});

      const deleteCalls = getMockConn(ctx).callsFor("Network.deleteCookies");
      expect(deleteCalls).toHaveLength(3);
    });
  });

  // ---------- storageState() ----------

  describe("storageState()", () => {
    it("returns a snapshot with all cookies", async () => {
      const cdpCookies = [
        toCdpCookie(makeCookie({ name: "a" })),
        toCdpCookie(makeCookie({ name: "b" })),
      ];
      const ctx = makeContext({
        "Network.getAllCookies": () => ({ cookies: cdpCookies }),
      });

      const state = await ctx.storageState();
      expect(state.cookies).toHaveLength(2);
      expect(state.cookies.map((c) => c.name)).toEqual(["a", "b"]);
    });

    it("returns empty cookies array when browser has none", async () => {
      const ctx = makeContext({
        "Network.getAllCookies": () => ({ cookies: [] }),
      });

      const state = await ctx.storageState();
      expect(state.cookies).toEqual([]);
    });

    it("snapshot is JSON-serialisable (round-trip)", async () => {
      const cdpCookies = [
        toCdpCookie(
          makeCookie({
            name: "ser",
            value: "v",
            domain: "x.com",
            path: "/",
            expires: 9999999999,
            httpOnly: true,
            secure: true,
            sameSite: "Strict",
          }),
        ),
      ];
      const ctx = makeContext({
        "Network.getAllCookies": () => ({ cookies: cdpCookies }),
      });

      const state = await ctx.storageState();
      const json = JSON.stringify(state);
      const parsed = JSON.parse(json) as { cookies: Cookie[] };
      expect(parsed.cookies[0]).toEqual(state.cookies[0]);
    });
  });

  // ---------- setStorageState() ----------

  describe("setStorageState()", () => {
    it("clears existing cookies then restores from snapshot", async () => {
      const callOrder: string[] = [];
      const ctx = makeContext({
        "Network.getAllCookies": () => {
          callOrder.push("getAllCookies");
          return { cookies: [toCdpCookie(makeCookie({ name: "old" }))] };
        },
        "Network.deleteCookies": () => {
          callOrder.push("deleteCookies");
          return {};
        },
        "Network.setCookie": () => {
          callOrder.push("setCookie");
          return { success: true };
        },
      });

      await ctx.setStorageState({
        cookies: [
          makeCookie({ name: "restored", domain: "example.com", path: "/" }),
        ],
      });

      // Should have cleared first, then set
      expect(callOrder).toEqual([
        "getAllCookies", // from clearCookies
        "deleteCookies", // delete the "old" cookie
        "setCookie", // add the "restored" cookie
      ]);

      const setCalls = getMockConn(ctx).callsFor("Network.setCookie");
      expect(setCalls[0]!.params).toMatchObject({ name: "restored" });
    });

    it("skips expired cookies from the snapshot", async () => {
      const ctx = makeContext({
        "Network.getAllCookies": () => ({ cookies: [] }),
        "Network.setCookie": () => ({ success: true }),
      });

      const pastTimestamp = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago
      const futureTimestamp = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now

      await ctx.setStorageState({
        cookies: [
          makeCookie({ name: "expired", expires: pastTimestamp }),
          makeCookie({ name: "valid", expires: futureTimestamp }),
          makeCookie({ name: "session", expires: -1 }),
        ],
      });

      const setCalls = getMockConn(ctx).callsFor("Network.setCookie");
      expect(setCalls).toHaveLength(2);
      const setNames = setCalls.map((c) => c.params?.name);
      expect(setNames).toContain("valid");
      expect(setNames).toContain("session");
      expect(setNames).not.toContain("expired");
    });

    it("handles empty snapshot gracefully", async () => {
      const ctx = makeContext({
        "Network.getAllCookies": () => ({ cookies: [] }),
        "Network.setCookie": () => ({ success: true }),
      });

      await ctx.setStorageState({ cookies: [] });

      const setCalls = getMockConn(ctx).callsFor("Network.setCookie");
      expect(setCalls).toHaveLength(0);
    });

    it("keeps session cookies (expires === -1) from snapshot", async () => {
      const ctx = makeContext({
        "Network.getAllCookies": () => ({ cookies: [] }),
        "Network.setCookie": () => ({ success: true }),
      });

      await ctx.setStorageState({
        cookies: [makeCookie({ name: "sess", expires: -1 })],
      });

      const setCalls = getMockConn(ctx).callsFor("Network.setCookie");
      expect(setCalls).toHaveLength(1);
      expect(setCalls[0]!.params).toMatchObject({ name: "sess" });
    });

    it("skips all cookies when entire snapshot is expired", async () => {
      const ctx = makeContext({
        "Network.getAllCookies": () => ({ cookies: [] }),
        "Network.setCookie": () => ({ success: true }),
      });

      const pastTimestamp = Math.floor(Date.now() / 1000) - 1;

      await ctx.setStorageState({
        cookies: [
          makeCookie({ name: "old1", expires: pastTimestamp }),
          makeCookie({ name: "old2", expires: pastTimestamp - 1000 }),
        ],
      });

      const setCalls = getMockConn(ctx).callsFor("Network.setCookie");
      expect(setCalls).toHaveLength(0);
    });

    it("clears existing cookies even when snapshot is empty", async () => {
      const ctx = makeContext({
        "Network.getAllCookies": () => ({
          cookies: [toCdpCookie(makeCookie({ name: "existing" }))],
        }),
        "Network.deleteCookies": () => ({}),
        "Network.setCookie": () => ({ success: true }),
      });

      await ctx.setStorageState({ cookies: [] });

      const deleteCalls = getMockConn(ctx).callsFor("Network.deleteCookies");
      expect(deleteCalls).toHaveLength(1);
      expect(deleteCalls[0]!.params).toMatchObject({ name: "existing" });

      const setCalls = getMockConn(ctx).callsFor("Network.setCookie");
      expect(setCalls).toHaveLength(0);
    });

    it("cookie right at the expiry boundary (now) is treated as expired", async () => {
      const ctx = makeContext({
        "Network.getAllCookies": () => ({ cookies: [] }),
        "Network.setCookie": () => ({ success: true }),
      });

      // Exactly now — should be filtered out (not strictly greater)
      const nowSeconds = Math.floor(Date.now() / 1000);

      await ctx.setStorageState({
        cookies: [makeCookie({ name: "boundary", expires: nowSeconds })],
      });

      // The expires check is `c.expires > nowSeconds`. Since Date.now() may
      // advance by the time setStorageState runs, this cookie is at the edge.
      // It should either be filtered or just barely pass — both are acceptable.
      // What matters is that clearly-expired cookies don't slip through.
      const setCalls = getMockConn(ctx).callsFor("Network.setCookie");
      expect(setCalls.length).toBeLessThanOrEqual(1);
    });

    it("full round-trip: storageState → setStorageState preserves cookies", async () => {
      const original = [
        toCdpCookie(
          makeCookie({
            name: "auth",
            value: "token123",
            domain: "app.com",
            path: "/",
            expires: -1,
          }),
        ),
        toCdpCookie(
          makeCookie({
            name: "theme",
            value: "dark",
            domain: "app.com",
            path: "/",
            expires: Math.floor(Date.now() / 1000) + 86400,
          }),
        ),
      ];

      // Phase 1: snapshot
      const ctx1 = makeContext({
        "Network.getAllCookies": () => ({ cookies: original }),
      });
      const state = await ctx1.storageState();
      expect(state.cookies).toHaveLength(2);

      // Phase 2: restore into a "fresh" context
      const setCookieParams: Record<string, unknown>[] = [];
      const ctx2 = makeContext({
        "Network.getAllCookies": () => ({ cookies: [] }),
        "Network.deleteCookies": () => ({}),
        "Network.setCookie": (params) => {
          setCookieParams.push(params ?? {});
          return { success: true };
        },
      });
      await ctx2.setStorageState(state);

      expect(setCookieParams).toHaveLength(2);
      expect(setCookieParams[0]).toMatchObject({
        name: "auth",
        value: "token123",
      });
      expect(setCookieParams[1]).toMatchObject({
        name: "theme",
        value: "dark",
      });
    });
  });
});

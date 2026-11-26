import { describe, expect, it } from "vitest";
import { z } from "zod/v4";
import type { Cookie, CookieParam } from "@browserbasehq/stagehand-protocol/types";
import { filterCookies, normalizeCookieParams } from "./cookies.js";

describe("cookie URL filtering", () => {
  const cookie: Cookie = {
    name: "session",
    value: "value",
    domain: "example.com",
    path: "/",
    expires: -1,
    httpOnly: false,
    secure: false,
    sameSite: "Lax",
  };

  it.each([
    ["example.com", "example.com", true],
    ["example.com", "sub.example.com", false],
    ["example.com", "nested.sub.example.com", false],
    ["sub.example.com", "sub.example.com", true],
    ["sub.example.com", "nested.sub.example.com", false],
    ["example.com", "notexample.com", false],
    ["example.com", "example.com.other.test", false],
    [".example.com", "example.com", true],
    [".example.com", "sub.example.com", true],
    [".example.com", "nested.sub.example.com", true],
    [".example.com", "notexample.com", false],
    [".example.com", "example.com.other.test", false],
  ])("domain %s matches hostname %s: %s", (domain, hostname, matches) => {
    const candidate = { ...cookie, domain };
    expect(filterCookies([candidate], [`https://${hostname}/`])).toEqual(
      matches ? [candidate] : [],
    );
  });

  it.each(["example.com", ".example.com"])("preserves secure filtering for %s", (domain) => {
    const candidate = { ...cookie, domain, secure: true };
    expect(filterCookies([candidate], ["https://example.com/"])).toEqual([candidate]);
    expect(filterCookies([candidate], ["http://example.com/"])).toEqual([]);
  });

  it.each(["example.com", ".example.com"])("preserves path boundaries for %s", (domain) => {
    const candidate = { ...cookie, domain, path: "/account" };
    for (const path of ["/account", "/account/profile"]) {
      expect(filterCookies([candidate], [`https://example.com${path}`])).toEqual([candidate]);
    }
    for (const path of ["/", "/accounts", "/accounting/profile"]) {
      expect(filterCookies([candidate], [`https://example.com${path}`])).toEqual([]);
    }
  });

  it("returns all cookies without URL filters and accepts any matching URL", () => {
    expect(filterCookies([cookie], [])).toEqual([cookie]);
    expect(filterCookies([cookie], ["https://sub.example.com/", "https://example.com/"])).toEqual([
      cookie,
    ]);
  });
});

describe("cookie validation and normalization", () => {
  it("normalizes a URL-backed cookie after schema validation", () => {
    expect(
      normalizeCookieParams([
        {
          name: "session",
          value: "value",
          url: "https://example.com/account/profile",
          sameSite: "None",
        },
      ]),
    ).toStrictEqual([
      {
        name: "session",
        value: "value",
        domain: "example.com",
        path: "/account/",
        secure: true,
        sameSite: "None",
      },
    ]);
  });

  it.each([
    [{ name: "session", value: "value" }, 'Cookie "session" must have a url or a domain/path pair'],
    [
      { name: "session", value: "value", url: "about:blank" },
      'Blank page cannot have cookie "session"',
    ],
    [
      { name: "session", value: "value", url: "not a url" },
      'Cookie "session" has an invalid url: "not a url"',
    ],
    [
      {
        name: "session",
        value: "value",
        domain: "example.com",
        path: "/",
        sameSite: "None",
      },
      'Cookie "session" has sameSite: "None" without secure: true. Browsers require secure: true when sameSite is "None".',
    ],
  ] as const)("returns a Zod issue for invalid cookie input", (cookie, message) => {
    expect(() => normalizeCookieParams([cookie as CookieParam])).toThrow(z.ZodError);

    try {
      normalizeCookieParams([cookie as CookieParam]);
    } catch (error) {
      expect(error).toBeInstanceOf(z.ZodError);
      if (error instanceof z.ZodError) expect(error.issues[0]?.message).toBe(message);
    }
  });

  it("returns a Zod error for an invalid cookie filter URL", () => {
    expect(() => filterCookies([], ["not a url"])).toThrow(z.ZodError);
  });
});

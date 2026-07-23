import { describe, expect, it } from "vite-plus/test";
import { z } from "zod/v4";
import type { CookieParam } from "../../protocol/types.js";
import { filterCookies, normalizeCookieParams } from "./cookies.js";

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

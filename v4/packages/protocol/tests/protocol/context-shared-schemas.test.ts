import { describe, expect, it } from "vite-plus/test";
import {
  ClearCookieOptionsSchema,
  CookieFilterSchema,
  CookieParamSchema,
  CookieRegexSchema,
  CookieSchema,
  DomainPolicySchema,
} from "../../schemas.js";

describe("shared context protocol schemas", () => {
  it("parses browser cookies", () => {
    const cookie = {
      name: "session",
      value: "abc123",
      domain: ".example.com",
      path: "/",
      expires: -1,
      httpOnly: true,
      secure: true,
      sameSite: "Lax" as const,
    };

    expect(CookieSchema.parse(cookie)).toStrictEqual(cookie);
    expect(() => CookieSchema.parse({ ...cookie, expires: Number.POSITIVE_INFINITY })).toThrow();
    expect(() => CookieSchema.parse({ ...cookie, extra: true })).toThrow();
  });

  it("validates cookie params", () => {
    expect(
      CookieParamSchema.parse({
        name: "session",
        value: "abc123",
        url: "https://example.com/account",
        sameSite: "None",
      }),
    ).toStrictEqual({
      name: "session",
      value: "abc123",
      url: "https://example.com/account",
      sameSite: "None",
    });
    expect(
      CookieParamSchema.parse({
        name: "preference",
        value: "compact",
        domain: "example.com",
        path: "/",
      }),
    ).toStrictEqual({
      name: "preference",
      value: "compact",
      domain: "example.com",
      path: "/",
    });

    expect(() => CookieParamSchema.parse({ name: "missing-target", value: "1" })).toThrow();
    expect(() =>
      CookieParamSchema.parse({
        name: "conflicting-target",
        value: "1",
        url: "https://example.com",
        domain: "example.com",
        path: "/",
      }),
    ).toThrow();
    expect(() =>
      CookieParamSchema.parse({
        name: "invalid-expiry",
        value: "1",
        domain: "example.com",
        path: "/",
        expires: -2,
      }),
    ).toThrow();
    expect(() =>
      CookieParamSchema.parse({
        name: "insecure-none",
        value: "1",
        domain: "example.com",
        path: "/",
        sameSite: "None",
      }),
    ).toThrow();
  });

  it("uses serializable descriptors for regular-expression cookie filters", () => {
    expect(CookieRegexSchema.parse({ source: "^session-", flags: "i" })).toStrictEqual({
      source: "^session-",
      flags: "i",
    });
    expect(CookieFilterSchema.parse("session-id")).toBe("session-id");
    expect(CookieFilterSchema.parse({ source: "^session-" })).toStrictEqual({
      source: "^session-",
    });
    expect(
      ClearCookieOptionsSchema.parse({
        name: { source: "^session-", flags: "i" },
        domain: "example.com",
      }),
    ).toStrictEqual({
      name: { source: "^session-", flags: "i" },
      domain: "example.com",
    });

    expect(() => CookieRegexSchema.parse({ source: "(", flags: "i" })).toThrow();
    expect(() => CookieRegexSchema.parse({ source: "session", flags: "ii" })).toThrow();
    expect(() => CookieRegexSchema.parse({ source: "session", flags: "x" })).toThrow();
    expect(() => CookieRegexSchema.parse({ source: "session", extra: true })).toThrow();
    expect(() => ClearCookieOptionsSchema.parse({ unknown: "value" })).toThrow();
  });

  it("parses strict domain policies", () => {
    expect(
      DomainPolicySchema.parse({
        allowedDomains: ["example.com", "*.example.com"],
        blockedDomains: ["ads.example.com"],
      }),
    ).toStrictEqual({
      allowedDomains: ["example.com", "*.example.com"],
      blockedDomains: ["ads.example.com"],
    });
    expect(DomainPolicySchema.parse({})).toStrictEqual({});
    expect(() => DomainPolicySchema.parse({ allowedDomains: "example.com" })).toThrow();
    expect(() => DomainPolicySchema.parse({ allowedDomains: [], extra: true })).toThrow();
  });
});

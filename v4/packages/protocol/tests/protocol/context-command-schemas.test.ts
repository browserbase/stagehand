import { describe, expect, it } from "vite-plus/test";
import {
  ContextActivePageResultSchema,
  ContextAddCookiesParamsSchema,
  ContextAddInitScriptParamsSchema,
  ContextClearCookiesParamsSchema,
  ContextClipboardClearParamsSchema,
  ContextClipboardCopyParamsSchema,
  ContextClipboardCutParamsSchema,
  ContextClipboardPasteParamsSchema,
  ContextClipboardReadTextParamsSchema,
  ContextClipboardReadTextResultSchema,
  ContextClipboardWriteTextParamsSchema,
  ContextCloseResultSchema,
  ContextCookiesParamsSchema,
  ContextCookiesResultSchema,
  ContextGetDomainPolicyResultSchema,
  ContextSetActivePageParamsSchema,
  ContextSetDomainPolicyParamsSchema,
  ContextSetExtraHTTPHeadersParamsSchema,
  ContextVoidResultSchema,
  EmptyParamsSchema,
} from "../../schemas.js";

describe("context lifecycle and configuration command schemas", () => {
  it("parses active-page lookup and selection values", () => {
    expect(EmptyParamsSchema.parse({})).toStrictEqual({});
    expect(ContextActivePageResultSchema.parse(null)).toBeNull();
    expect(
      ContextActivePageResultSchema.parse({
        pageId: "page-1",
        url: "https://example.com",
        title: "Example",
      }),
    ).toStrictEqual({
      pageId: "page-1",
      url: "https://example.com",
      title: "Example",
    });
    expect(ContextSetActivePageParamsSchema.parse({ pageId: "page-1" })).toStrictEqual({
      pageId: "page-1",
    });

    expect(() => ContextActivePageResultSchema.parse(undefined)).toThrow();
    expect(() =>
      ContextSetActivePageParamsSchema.parse({ pageId: "page-1", extra: true }),
    ).toThrow();
  });

  it("parses context init scripts and opaque HTTP headers", () => {
    expect(
      ContextAddInitScriptParamsSchema.parse({ source: "globalThis.ready = true" }),
    ).toStrictEqual({ source: "globalThis.ready = true" });
    expect(
      ContextSetExtraHTTPHeadersParamsSchema.parse({
        headers: { "X-Request-ID": "request-1", doNotRenameMe: "value" },
      }),
    ).toStrictEqual({
      headers: { "X-Request-ID": "request-1", doNotRenameMe: "value" },
    });

    expect(() => ContextAddInitScriptParamsSchema.parse({ source: 1 })).toThrow();
    expect(() =>
      ContextSetExtraHTTPHeadersParamsSchema.parse({
        headers: { "X-Request-ID": 1 },
      }),
    ).toThrow();
    expect(() =>
      ContextSetExtraHTTPHeadersParamsSchema.parse({ headers: {}, extra: true }),
    ).toThrow();
  });

  it("requires an explicit object or null when setting domain policy", () => {
    expect(
      ContextSetDomainPolicyParamsSchema.parse({
        policy: {
          allowedDomains: ["example.com", "*.example.com"],
          blockedDomains: ["ads.example.com"],
        },
      }),
    ).toStrictEqual({
      policy: {
        allowedDomains: ["example.com", "*.example.com"],
        blockedDomains: ["ads.example.com"],
      },
    });
    expect(ContextSetDomainPolicyParamsSchema.parse({ policy: null })).toStrictEqual({
      policy: null,
    });
    expect(ContextGetDomainPolicyResultSchema.parse({ policy: null })).toStrictEqual({
      policy: null,
    });
    expect(
      ContextGetDomainPolicyResultSchema.parse({
        policy: { blockedDomains: ["ads.example.com"] },
      }),
    ).toStrictEqual({ policy: { blockedDomains: ["ads.example.com"] } });

    expect(() => ContextSetDomainPolicyParamsSchema.parse({})).toThrow();
    expect(() => ContextSetDomainPolicyParamsSchema.parse({ policy: undefined })).toThrow();
    expect(() => ContextGetDomainPolicyResultSchema.parse({ policy: null, extra: true })).toThrow();
  });

  it("keeps context mutation and close results strict", () => {
    expect(ContextVoidResultSchema.parse({ ok: true })).toStrictEqual({ ok: true });
    expect(ContextCloseResultSchema.parse({ closed: true })).toStrictEqual({ closed: true });
    expect(() => ContextVoidResultSchema.parse({ ok: true, extra: true })).toThrow();
    expect(() => ContextCloseResultSchema.parse({ closed: false })).toThrow();
  });
});

describe("context cookie command schemas", () => {
  const cookie = {
    name: "session",
    value: "abc123",
    domain: "example.com",
    path: "/",
    expires: -1,
    httpOnly: true,
    secure: true,
    sameSite: "Lax" as const,
  };

  it("parses optional cookie URL filters", () => {
    expect(ContextCookiesParamsSchema.parse({})).toStrictEqual({});
    expect(ContextCookiesParamsSchema.parse({ urls: "https://example.com/account" })).toStrictEqual(
      { urls: "https://example.com/account" },
    );
    expect(
      ContextCookiesParamsSchema.parse({
        urls: ["https://example.com/account", "https://example.org/"],
      }),
    ).toStrictEqual({
      urls: ["https://example.com/account", "https://example.org/"],
    });

    expect(() => ContextCookiesParamsSchema.parse({ urls: 1 })).toThrow();
    expect(() => ContextCookiesParamsSchema.parse({ urls: [], extra: true })).toThrow();
  });

  it("parses cookie results and rejects invalid browser values", () => {
    expect(ContextCookiesResultSchema.parse({ cookies: [cookie] })).toStrictEqual({
      cookies: [cookie],
    });
    expect(() =>
      ContextCookiesResultSchema.parse({
        cookies: [{ ...cookie, sameSite: "Invalid" }],
      }),
    ).toThrow();
    expect(() => ContextCookiesResultSchema.parse({ cookies: [], extra: true })).toThrow();
  });

  it("validates cookies before adding them", () => {
    expect(
      ContextAddCookiesParamsSchema.parse({
        cookies: [
          {
            name: "session",
            value: "abc123",
            url: "https://example.com/account",
          },
        ],
      }),
    ).toStrictEqual({
      cookies: [
        {
          name: "session",
          value: "abc123",
          url: "https://example.com/account",
        },
      ],
    });
    expect(ContextAddCookiesParamsSchema.parse({ cookies: [] })).toStrictEqual({ cookies: [] });

    expect(() =>
      ContextAddCookiesParamsSchema.parse({
        cookies: [{ name: "missing-target", value: "1" }],
      }),
    ).toThrow();
  });

  it("parses exact and regex clear-cookie filters", () => {
    expect(ContextClearCookiesParamsSchema.parse({})).toStrictEqual({});
    expect(
      ContextClearCookiesParamsSchema.parse({
        options: {
          name: { source: "^session-", flags: "i" },
          domain: "example.com",
          path: "/account",
        },
      }),
    ).toStrictEqual({
      options: {
        name: { source: "^session-", flags: "i" },
        domain: "example.com",
        path: "/account",
      },
    });

    expect(() => ContextClearCookiesParamsSchema.parse({ name: "session" })).toThrow();
    expect(() =>
      ContextClearCookiesParamsSchema.parse({
        options: { name: { source: "(", flags: "i" } },
      }),
    ).toThrow();
  });
});

describe("context clipboard command schemas", () => {
  it("parses optional page targeting", () => {
    expect(ContextClipboardReadTextParamsSchema.parse({})).toStrictEqual({});
    expect(ContextClipboardReadTextParamsSchema.parse({ pageId: "page-1" })).toStrictEqual({
      pageId: "page-1",
    });
    expect(ContextClipboardClearParamsSchema.parse({ pageId: "page-1" })).toStrictEqual({
      pageId: "page-1",
    });
    expect(ContextClipboardCopyParamsSchema.parse({})).toStrictEqual({});
    expect(ContextClipboardCutParamsSchema.parse({})).toStrictEqual({});

    expect(() =>
      ContextClipboardReadTextParamsSchema.parse({ pageId: "page-1", extra: true }),
    ).toThrow();
  });

  it("requires text when writing to the clipboard", () => {
    expect(
      ContextClipboardWriteTextParamsSchema.parse({
        text: "copied text",
        pageId: "page-1",
      }),
    ).toStrictEqual({ text: "copied text", pageId: "page-1" });

    expect(() => ContextClipboardWriteTextParamsSchema.parse({})).toThrow();
    expect(() => ContextClipboardWriteTextParamsSchema.parse({ text: 1 })).toThrow();
  });

  it("validates clipboard paste shortcuts", () => {
    expect(
      ContextClipboardPasteParamsSchema.parse({
        pageId: "page-1",
        shortcut: "ControlOrMeta+V",
      }),
    ).toStrictEqual({ pageId: "page-1", shortcut: "ControlOrMeta+V" });
    expect(ContextClipboardPasteParamsSchema.parse({ shortcut: "Meta+V" })).toStrictEqual({
      shortcut: "Meta+V",
    });
    expect(ContextClipboardPasteParamsSchema.parse({ shortcut: "Control+V" })).toStrictEqual({
      shortcut: "Control+V",
    });

    expect(() => ContextClipboardPasteParamsSchema.parse({ shortcut: "Shift+V" })).toThrow();
  });

  it("parses strict clipboard read results", () => {
    expect(ContextClipboardReadTextResultSchema.parse({ text: "copied text" })).toStrictEqual({
      text: "copied text",
    });
    expect(() =>
      ContextClipboardReadTextResultSchema.parse({ text: "copied text", extra: true }),
    ).toThrow();
  });
});

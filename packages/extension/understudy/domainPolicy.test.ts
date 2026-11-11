import { describe, expect, it } from "vitest";
import type { DomainPolicy } from "@browserbasehq/stagehand-protocol/types";
import {
  getDomainPolicyDecision,
  normalizeDomainPolicy,
  toDomainPolicyDnrRules,
} from "./domainPolicy.js";

// Evaluate the compiler's regex/priority subset against Chrome-style serialized URLs.
// This checks policy semantics; Chrome's RE2 validation and actual enforcement belong
// in the installer and browser integration tests.
function compiledDecision(rules: chrome.declarativeNetRequest.Rule[], url: string) {
  const serializedUrl = new URL(url).href;
  const matchingRules = rules
    .filter(({ condition }) =>
      new RegExp(condition.regexFilter!, condition.isUrlFilterCaseSensitive ? "" : "i").test(
        serializedUrl,
      ),
    )
    .sort((a, b) => (b.priority ?? 1) - (a.priority ?? 1));
  return matchingRules[0]?.action.type === "block" ? "block" : "continue";
}

function compile(policy: DomainPolicy | null) {
  return toDomainPolicyDnrRules(normalizeDomainPolicy(policy));
}

describe("domain policy DNR compiler", () => {
  it.each([null, {}, { allowedDomains: [], blockedDomains: [] }])(
    "emits no rules for an inactive policy: %j",
    (policy) => {
      expect(compile(policy)).toEqual([]);
    },
  );

  it("uses unique positive IDs and produces deterministic rules without mutating the policy", () => {
    const policy = normalizeDomainPolicy({
      allowedDomains: [" EXAMPLE.TEST. ", "*.example.test", "example.test"],
      blockedDomains: ["BLOCKED.TEST", "blocked.test.", "*.private.test"],
    });
    const original = structuredClone(policy);
    const rules = toDomainPolicyDnrRules(policy);

    expect(rules).toHaveLength(5);
    expect(rules.map(({ id }) => id)).toEqual([1, 2, 3, 4, 5]);
    expect(toDomainPolicyDnrRules(policy)).toEqual(rules);
    expect(policy).toEqual(original);
  });

  it("covers all resource types, methods and initiators without restricting rules to tabs", () => {
    const rules = compile({
      allowedDomains: ["allowed.test"],
      blockedDomains: ["blocked.test"],
    });

    for (const rule of rules) {
      expect(rule.condition).toEqual({
        regexFilter: expect.any(String),
        isUrlFilterCaseSensitive: false,
        resourceTypes: [
          "main_frame",
          "sub_frame",
          "stylesheet",
          "script",
          "image",
          "font",
          "object",
          "xmlhttprequest",
          "ping",
          "csp_report",
          "media",
          "websocket",
          "webtransport",
          "webbundle",
          "other",
        ],
      });
      expect(["allow", "block"]).toContain(rule.action.type);
    }
  });

  it.each([
    "http://blocked.test/",
    "https://blocked.test/",
    "http://user@blocked.test/",
    "http://user:pass@blocked.test/",
    "http://user:p%40ss@blocked.test/",
    "http://@blocked.test/",
    "https://user:pass@BLOCKED.TEST:8443/path?query=value#fragment",
    "http://blocked.test./",
    "http://blocked.test../",
    "http://user:pass@blocked.test...:8080/path",
    "http://%62locked.test/",
  ])("blocks an exact host regardless of URL spelling: %s", (url) => {
    expect(compiledDecision(compile({ blockedDomains: ["blocked.test"] }), url)).toBe("block");
  });

  it.each([
    "http://sub.blocked.test/",
    "http://blocked.testing/",
    "http://blocked.test.other.test/",
    "http://blockedXtest/",
    "http://notblocked.test/",
    "http://blocked.test@example.com/",
    "http://blocked.test:password@example.com/",
    "http://example.com/blocked.test/",
    "http://example.com/?next=http://x@blocked.test/",
    "http://example.com/#http://blocked.test/",
  ])("does not block an exact-host lookalike: %s", (url) => {
    expect(compiledDecision(compile({ blockedDomains: ["blocked.test"] }), url)).toBe("continue");
  });

  it.each([
    ["http://sub.blocked.test/", "block"],
    ["http://.blocked.test/", "block"],
    ["http://sub..blocked.test/", "block"],
    ["https://user:pass@deep.sub.blocked.test..:8443/path", "block"],
    ["http://blocked.test/", "continue"],
    ["http://user:pass@blocked.test../", "continue"],
    ["http://sub.blocked.test.other.test/", "continue"],
    ["http://sub.blocked.test@example.com/", "continue"],
    ["http://example.com/sub.blocked.test/", "continue"],
    ["http://example.com/?next=http://user@sub.blocked.test/", "continue"],
  ])("preserves wildcard subdomain semantics: %s", (url, expected) => {
    expect(compiledDecision(compile({ blockedDomains: ["*.blocked.test"] }), url)).toBe(expected);
  });

  it.each([
    ["http://allowed.test/", "continue"],
    ["https://user:pass@allowed.test..:8443/path", "continue"],
    ["http://sub.allowed.test/", "block"],
    ["http://other.test/", "block"],
    ["http://allowed.test.other.test/", "block"],
    ["http://allowed.test@other.test/", "block"],
    ["http://other.test/?next=http://user@allowed.test/", "block"],
  ])("allows only the exact allowlisted host: %s", (url, expected) => {
    expect(compiledDecision(compile({ allowedDomains: ["allowed.test"] }), url)).toBe(expected);
  });

  it.each([
    ["http://sub.allowed.test/", "continue"],
    ["http://user:pass@deep.sub.allowed.test...:8080/path", "continue"],
    ["http://allowed.test/", "block"],
    ["http://sub.allowed.test@other.test/", "block"],
    ["http://sub.allowed.test.other.test/", "block"],
  ])("preserves wildcard allowlist semantics: %s", (url, expected) => {
    expect(compiledDecision(compile({ allowedDomains: ["*.allowed.test"] }), url)).toBe(expected);
  });

  it.each([
    {
      policy: { allowedDomains: ["example.test"], blockedDomains: ["example.test"] },
      url: "http://user:pass@example.test../",
    },
    {
      policy: { allowedDomains: ["*.example.test"], blockedDomains: ["private.example.test"] },
      url: "http://private.example.test/",
    },
    {
      policy: { allowedDomains: ["public.example.test"], blockedDomains: ["*.example.test"] },
      url: "https://user:pass@public.example.test:8443/",
    },
  ])("gives an explicit block precedence over an allow: $url", ({ policy, url }) => {
    expect(compiledDecision(compile(policy), url)).toBe("block");
  });

  it("continues to allow other hosts under an overlapping policy", () => {
    const rules = compile({
      allowedDomains: ["*.example.test"],
      blockedDomains: ["private.example.test"],
    });
    expect(compiledDecision(rules, "https://public.example.test/")).toBe("continue");
    expect(compiledDecision(rules, "https://other.test/")).toBe("block");
  });

  it.each([
    ["http://user:pass@127.0.0.2:8080/", "block"],
    ["http://127.0.0.3/", "continue"],
    ["http://127.0.0.2@example.com/", "continue"],
  ])("handles exact IPv4 addresses: %s", (url, expected) => {
    expect(compiledDecision(compile({ blockedDomains: ["127.0.0.2"] }), url)).toBe(expected);
  });

  it("matches internationalized URLs against their ASCII hostname", () => {
    const rules = compile({ blockedDomains: ["xn--bcher-kva.test"] });
    expect(compiledDecision(rules, "https://user:pass@bücher.test/")).toBe("block");
    expect(compiledDecision(rules, "https://bücher.test.other.test/")).toBe("continue");
  });

  it.each([
    "about:blank",
    "data:text/html,blocked.test",
    "file:///blocked.test",
    "ftp://blocked.test/",
    "ws://blocked.test/",
    "wss://blocked.test/",
    "blob:https://blocked.test/id",
  ])("leaves non-HTTP(S) URLs outside the policy: %s", (url) => {
    for (const policy of [
      { blockedDomains: ["blocked.test"] },
      { allowedDomains: ["allowed.test"] },
    ]) {
      expect(compiledDecision(compile(policy), url)).toBe("continue");
    }
  });

  it("agrees with hostname-based policy decisions across URL and policy combinations", () => {
    const policies: DomainPolicy[] = [
      { blockedDomains: ["example.test"] },
      { blockedDomains: ["*.example.test"] },
      { allowedDomains: ["example.test"] },
      { allowedDomains: ["*.example.test"] },
      {
        allowedDomains: ["example.test", "*.example.test"],
        blockedDomains: ["private.example.test", "*.private.example.test"],
      },
    ];
    for (const policy of policies) {
      const normalized = normalizeDomainPolicy(policy);
      const rules = toDomainPolicyDnrRules(normalized);
      for (const scheme of ["http", "https"]) {
        for (const userinfo of ["", "user@", "user:pass@", "user:p%40ss@"]) {
          for (const hostname of [
            "example.test",
            "EXAMPLE.TEST",
            "sub.example.test",
            ".example.test",
            "..example.test",
            "sub..example.test",
            "private.example.test",
            "deep.private.example.test",
            "example.test.other.test",
            "other.test",
          ]) {
            for (const suffix of ["", ".", "..", ":8080", "..:8080"]) {
              const url = new URL(
                scheme +
                  "://" +
                  userinfo +
                  hostname +
                  suffix +
                  "/path?next=http://x@example.test/#fragment",
              ).href;
              expect(compiledDecision(rules, url), JSON.stringify({ policy, url })).toBe(
                getDomainPolicyDecision(url, normalized).action,
              );
            }
          }
        }
      }
    }
  });
});

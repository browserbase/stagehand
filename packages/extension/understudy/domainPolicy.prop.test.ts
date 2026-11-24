import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { DomainPolicy } from "@browserbasehq/stagehand-protocol/types";
import {
  getDomainPolicyDecision,
  normalizeDomainPolicy,
  toDomainPolicyDnrRules,
  type NormalizedDomainPolicy,
} from "./domainPolicy.js";

function evaluateDnrRules(
  rules: chrome.declarativeNetRequest.Rule[],
  targetUrl: string,
): "block" | "continue" {
  const matched = rules
    .filter(({ condition }) => {
      if (condition.regexFilter === undefined) return false;
      const flags = condition.isUrlFilterCaseSensitive ? "" : "i";
      return new RegExp(condition.regexFilter, flags).test(targetUrl);
    })
    .sort((a, b) => {
      const priorityDiff = (b.priority ?? 1) - (a.priority ?? 1);
      if (priorityDiff !== 0) return priorityDiff;
      if (a.action.type === b.action.type) return 0;
      return a.action.type === "block" ? -1 : 1;
    });

  return matched[0]?.action.type === "block" ? "block" : "continue";
}

function readZ3TemplateConstant(scriptSource: string, constantName: string): string {
  const match = scriptSource.match(new RegExp(`^${constantName}\\s*=\\s*r"([^"\\n]+)"$`, "m"));
  if (!match?.[1]) {
    throw new Error(`Missing ${constantName} in scripts/verify-domain-policy-z3.py`);
  }
  return match[1];
}

const alphaChars = "abcdefghijklmnopqrstuvwxyz".split("");
const alnumChars = "abcdefghijklmnopqrstuvwxyz0123456789".split("");
const labelMidChars = "abcdefghijklmnopqrstuvwxyz0123456789-".split("");

const validLabelArb: fc.Arbitrary<string> = fc
  .oneof(
    fc.constantFrom(...alnumChars),
    fc
      .tuple(
        fc.constantFrom(...alnumChars),
        fc.array(fc.constantFrom(...labelMidChars), { minLength: 0, maxLength: 8 }),
        fc.constantFrom(...alnumChars),
      )
      .map(([first, mid, last]) => `${first}${mid.join("")}${last}`),
  )
  .filter((label) => !label.includes("--"));

// WHATWG URL treats a final all-numeric label as an IPv4 parser trigger,
// so generated DNS hostnames use an alphabetic TLD (or a valid dotted-quad IPv4).
const validTldArb: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(...alphaChars), { minLength: 2, maxLength: 6 })
  .map((chars) => chars.join(""));

const ipv4HostArb: fc.Arbitrary<string> = fc
  .tuple(
    fc.integer({ min: 1, max: 254 }),
    fc.integer({ min: 0, max: 255 }),
    fc.integer({ min: 0, max: 255 }),
    fc.integer({ min: 1, max: 254 }),
  )
  .map((octets) => octets.join("."));

const validDnsHostnameArb: fc.Arbitrary<string> = fc
  .tuple(fc.array(validLabelArb, { minLength: 1, maxLength: 3 }), validTldArb)
  .map(([labels, tld]) => [...labels, tld].join("."))
  .filter((host) => host.length <= 253);

const validHostnameArb: fc.Arbitrary<string> = fc.oneof(
  { weight: 5, arbitrary: validDnsHostnameArb },
  { weight: 1, arbitrary: ipv4HostArb },
);

const randomCaseArb = (text: string): fc.Arbitrary<string> =>
  fc.array(fc.boolean(), { minLength: text.length, maxLength: text.length }).map((flips) =>
    text
      .split("")
      .map((ch, idx) => (flips[idx] ? ch.toUpperCase() : ch.toLowerCase()))
      .join(""),
  );

const whitespaceArb = fc
  .array(fc.constantFrom(" ", "\t"), { minLength: 0, maxLength: 3 })
  .map((ws) => ws.join(""));

const trailingDotsArb = fc.integer({ min: 0, max: 3 }).map((count) => ".".repeat(count));

const messyPatternArb: fc.Arbitrary<string> = fc
  .tuple(validHostnameArb, fc.boolean(), whitespaceArb, whitespaceArb, trailingDotsArb)
  .chain(([host, isWildcard, wsLeft, wsRight, dots]) =>
    randomCaseArb(host).map(
      (cased) => `${wsLeft}${isWildcard ? "*." : ""}${cased}${dots}${wsRight}`,
    ),
  );

const validPolicyArb: fc.Arbitrary<DomainPolicy> = fc.record({
  allowedDomains: fc.array(messyPatternArb, { minLength: 0, maxLength: 4 }),
  blockedDomains: fc.array(messyPatternArb, { minLength: 0, maxLength: 4 }),
});

const nonEmptyPolicyArb: fc.Arbitrary<DomainPolicy> = validPolicyArb.filter(
  (p) => (p.allowedDomains?.length ?? 0) > 0 || (p.blockedDomains?.length ?? 0) > 0,
);

const schemeArb = fc.constantFrom("http", "https");

const userinfoArb = fc.oneof(
  fc.constant(""),
  fc.constant("user@"),
  fc.constant("user:pass@"),
  fc.constant("user:p%40ss@"),
  fc.constant("a:b:c@"),
  validHostnameArb.map((h) => `${h}@`),
  validHostnameArb.map((h) => `sub.${h}:secret@`),
);

const portArb = fc.oneof(
  fc.constant(""),
  fc.integer({ min: 1, max: 65535 }).map((p) => `:${p}`),
);

const pathTailArb = fc.oneof(
  fc.constant("/"),
  fc.constant("/path/to/page"),
  validHostnameArb.map((h) => `/${h}/resource?next=http://user@${h}/#http://${h}`),
);

function buildHttpUrlArb(hostArb: fc.Arbitrary<string>): fc.Arbitrary<string> {
  return fc
    .tuple(schemeArb, userinfoArb, hostArb, trailingDotsArb, portArb, pathTailArb)
    .map(([scheme, userinfo, host, dots, port, tail]) => {
      // IPv6 literals and dotted-quad IPv4 literals do not accept arbitrary trailing dots in WHATWG URL.
      const effectiveDots = host.startsWith("[") || /^\d+(\.\d+){3}$/.test(host) ? "" : dots;
      return new URL(`${scheme}://${userinfo}${host}${effectiveDots}${port}${tail}`).href;
    });
}

const nonHttpUrlArb: fc.Arbitrary<string> = fc.oneof(
  fc.constant("about:blank"),
  validHostnameArb.map((h) => `ws://${h}/socket`),
  validHostnameArb.map((h) => `wss://${h}:8443/socket`),
  validHostnameArb.map((h) => `ftp://${h}/file.txt`),
  validHostnameArb.map((h) => `file:///${h}`),
  validHostnameArb.map((h) => `data:text/html,${h}`),
  validHostnameArb.map((h) => `blob:https://${h}/uuid`),
);

describe("domainPolicy property-based verification (fast-check)", () => {
  describe("Z3 model drift check", () => {
    it("matches the exact DNR regex templates encoded in scripts/verify-domain-policy-z3.py", () => {
      const z3ScriptPath = resolve(
        dirname(fileURLToPath(import.meta.url)),
        "../../../scripts/verify-domain-policy-z3.py",
      );
      const z3Script = readFileSync(z3ScriptPath, "utf8");
      const defaultBlockPattern = readZ3TemplateConstant(
        z3Script,
        "DNR_DEFAULT_ALLOWLIST_BLOCK_PATTERN",
      );
      const exactTemplate = readZ3TemplateConstant(z3Script, "DNR_EXACT_TEMPLATE");
      const wildcardTemplate = readZ3TemplateConstant(z3Script, "DNR_WILDCARD_TEMPLATE");

      const policy = normalizeDomainPolicy({
        allowedDomains: ["allowed.example.test", "*.sub.allowed.test"],
        blockedDomains: ["blocked.example.test", "*.sub.blocked.test"],
      });
      const rules = toDomainPolicyDnrRules(policy);

      expect(
        rules.map((r) => ({
          priority: r.priority,
          action: r.action.type,
          isCaseSensitive: r.condition.isUrlFilterCaseSensitive,
          regexFilter: r.condition.regexFilter,
        })),
      ).toEqual([
        {
          priority: 1,
          action: "block",
          isCaseSensitive: false,
          regexFilter: defaultBlockPattern,
        },
        {
          priority: 2,
          action: "allow",
          isCaseSensitive: false,
          regexFilter: exactTemplate.replace("{hostname}", "allowed\\.example\\.test"),
        },
        {
          priority: 2,
          action: "allow",
          isCaseSensitive: false,
          regexFilter: wildcardTemplate.replace("{hostname}", "sub\\.allowed\\.test"),
        },
        {
          priority: 3,
          action: "block",
          isCaseSensitive: false,
          regexFilter: exactTemplate.replace("{hostname}", "blocked\\.example\\.test"),
        },
        {
          priority: 3,
          action: "block",
          isCaseSensitive: false,
          regexFilter: wildcardTemplate.replace("{hostname}", "sub\\.blocked\\.test"),
        },
      ]);
    });
  });

  describe("normalization idempotence and determinism", () => {
    it("is idempotent: normalize(normalize(policy)) deep-equals normalize(policy)", () => {
      fc.assert(
        fc.property(fc.oneof(fc.constant(null), validPolicyArb), (policy) => {
          const once = normalizeDomainPolicy(policy);
          const twice = normalizeDomainPolicy(once);
          expect(twice).toEqual(once);

          if (once) {
            expect(once.allowedDomains).toHaveLength(once.allowedDomainRules.length);
            expect(once.blockedDomains).toHaveLength(once.blockedDomainRules.length);
            for (const entry of [...once.allowedDomains, ...once.blockedDomains]) {
              expect(entry).toBe(entry.trim().toLowerCase());
              expect(entry.endsWith(".")).toBe(false);
            }
          }
        }),
        { numRuns: 200 },
      );
    });

    it("deduplicates equivalent spellings (whitespace, casing, trailing dots) identically", () => {
      fc.assert(
        fc.property(
          validHostnameArb,
          fc.boolean(),
          whitespaceArb,
          trailingDotsArb,
          fc.constantFrom("allowedDomains" as const, "blockedDomains" as const),
          (host, isWildcard, ws, dots, side) => {
            const base = isWildcard ? `*.${host}` : host;
            const variant = `${ws}${base.toUpperCase()}${dots}${ws}`;
            const single = normalizeDomainPolicy({ [side]: [base] });
            const duped = normalizeDomainPolicy({
              [side]: [base, variant, variant.toLowerCase()],
            });
            expect(duped).toEqual(single);
            expect(toDomainPolicyDnrRules(duped)).toEqual(toDomainPolicyDnrRules(single));
          },
        ),
        { numRuns: 150 },
      );
    });

    it("compiles DNR rules deterministically with unique positive IDs and valid regexes", () => {
      fc.assert(
        fc.property(nonEmptyPolicyArb, (policy) => {
          const normalized = normalizeDomainPolicy(policy);
          const snapshot = structuredClone(normalized);
          const rules1 = toDomainPolicyDnrRules(normalized);
          const rules2 = toDomainPolicyDnrRules(normalized);

          expect(rules1).toEqual(rules2);
          expect(normalized).toEqual(snapshot);
          expect(rules1.map((r) => r.id)).toEqual(rules1.map((_, i) => i + 1));

          for (const rule of rules1) {
            expect(rule.condition.isUrlFilterCaseSensitive).toBe(false);
            expect(rule.condition.regexFilter).toBeDefined();
            const pattern = rule.condition.regexFilter!;
            expect(() => new RegExp(pattern, "i")).not.toThrow();
            expect(pattern).not.toMatch(/\(\?[=!<]|\\[1-9]/);
          }
        }),
        { numRuns: 150 },
      );
    });
  });

  describe("blocked-always-wins precedence", () => {
    it("blocks any URL matching blockedDomains even when allowedDomains also matches", () => {
      fc.assert(
        fc.property(
          validDnsHostnameArb,
          fc.boolean(),
          validLabelArb,
          fc.array(messyPatternArb, { minLength: 0, maxLength: 3 }),
          schemeArb,
          userinfoArb,
          trailingDotsArb,
          portArb,
          pathTailArb,
          (
            baseHost,
            blockAsWildcard,
            subLabel,
            extraAllowed,
            scheme,
            userinfo,
            dots,
            port,
            tail,
          ) => {
            const blockedPattern = blockAsWildcard ? `*.${baseHost}` : baseHost;
            const targetHost = blockAsWildcard ? `${subLabel}.${baseHost}` : baseHost;
            const policy = normalizeDomainPolicy({
              allowedDomains: [targetHost, `*.${baseHost}`, baseHost, ...extraAllowed],
              blockedDomains: [blockedPattern],
            });
            const rules = toDomainPolicyDnrRules(policy);
            const url = new URL(`${scheme}://${userinfo}${targetHost}${dots}${port}${tail}`).href;

            expect(getDomainPolicyDecision(url, policy)).toEqual({
              action: "block",
              reason: "blockedDomains",
            });
            expect(evaluateDnrRules(rules, url)).toBe("block");
          },
        ),
        { numRuns: 200 },
      );
    });
  });

  describe("wildcard and exact boundary safety", () => {
    it("wildcard *.D matches subdomains, never apex, lookalikes, userinfo, or paths", () => {
      fc.assert(
        fc.property(
          validDnsHostnameArb,
          validLabelArb,
          validDnsHostnameArb,
          schemeArb,
          userinfoArb,
          trailingDotsArb,
          portArb,
          pathTailArb,
          (domain, subLabel, otherDomain, scheme, userinfo, dots, port, tail) => {
            fc.pre(otherDomain !== domain && !otherDomain.endsWith(`.${domain}`));

            const policy = normalizeDomainPolicy({ blockedDomains: [`*.${domain}`] });
            const rules = toDomainPolicyDnrRules(policy);

            const makeUrl = (host: string, ui = userinfo, pTail = tail) =>
              new URL(`${scheme}://${ui}${host}${dots}${port}${pTail}`).href;

            const subUrl = makeUrl(`${subLabel}.${domain}`);
            const deepSubUrl = makeUrl(`deep.${subLabel}.${domain}`);
            for (const u of [subUrl, deepSubUrl]) {
              expect(getDomainPolicyDecision(u, policy).action).toBe("block");
              expect(evaluateDnrRules(rules, u)).toBe("block");
            }

            const negatives = [
              makeUrl(domain),
              makeUrl(`${subLabel}-${domain}`),
              makeUrl(`${subLabel}${domain}`),
              makeUrl(`${subLabel}.${domain}.${otherDomain}`),
              makeUrl(otherDomain, `${subLabel}.${domain}@`),
              makeUrl(otherDomain, "", `/${subLabel}.${domain}?next=http://${subLabel}.${domain}`),
            ];
            for (const u of negatives) {
              expect(getDomainPolicyDecision(u, policy).action).toBe("continue");
              expect(evaluateDnrRules(rules, u)).toBe("continue");
            }
          },
        ),
        { numRuns: 200 },
      );
    });

    it("exact D matches only D, never subdomains, unescaped-dot lookalikes, userinfo, or paths", () => {
      fc.assert(
        fc.property(
          validDnsHostnameArb,
          validLabelArb,
          validDnsHostnameArb,
          schemeArb,
          userinfoArb,
          trailingDotsArb,
          portArb,
          pathTailArb,
          (domain, subLabel, otherDomain, scheme, userinfo, dots, port, tail) => {
            fc.pre(otherDomain !== domain);

            const policy = normalizeDomainPolicy({ blockedDomains: [domain] });
            const rules = toDomainPolicyDnrRules(policy);

            const makeUrl = (host: string, ui = userinfo, pTail = tail) =>
              new URL(`${scheme}://${ui}${host}${dots}${port}${pTail}`).href;

            const exactUrl = makeUrl(domain);
            expect(getDomainPolicyDecision(exactUrl, policy).action).toBe("block");
            expect(evaluateDnrRules(rules, exactUrl)).toBe("block");

            const dotReplaced = domain.replace(".", "x");
            const negatives = [
              makeUrl(`${subLabel}.${domain}`),
              makeUrl(`${subLabel}-${domain}`),
              makeUrl(`${domain}.${otherDomain}`),
              makeUrl(otherDomain, `${domain}@`),
              makeUrl(otherDomain, "", `/${domain}?next=http://${domain}`),
              ...(dotReplaced !== domain ? [makeUrl(dotReplaced)] : []),
            ];
            for (const u of negatives) {
              expect(getDomainPolicyDecision(u, policy).action).toBe("continue");
              expect(evaluateDnrRules(rules, u)).toBe("continue");
            }
          },
        ),
        { numRuns: 200 },
      );
    });
  });

  describe("DNR soundness and equivalence with getDomainPolicyDecision", () => {
    it("agrees with getDomainPolicyDecision on all serialized HTTP(S) URLs including dot-only hosts", () => {
      const policyAndAdversarialUrlArb = nonEmptyPolicyArb.chain((rawPolicy) => {
        const norm = normalizeDomainPolicy(rawPolicy)!;
        const ruleHosts = [
          ...norm.allowedDomainRules.map((r) => r.hostname),
          ...norm.blockedDomainRules.map((r) => r.hostname),
        ];
        const dnsRuleHosts = ruleHosts.filter((h) => !/^\d+(\.\d+){3}$/.test(h));
        const targetedHostArb = fc.oneof(
          validHostnameArb,
          fc.constantFrom(...ruleHosts),
          ...(dnsRuleHosts.length
            ? [
                fc
                  .tuple(validLabelArb, fc.constantFrom(...dnsRuleHosts))
                  .map(([s, h]) => `${s}.${h}`),
                fc.constantFrom(...dnsRuleHosts).map((h) => `.${h}`),
                fc
                  .tuple(validLabelArb, fc.constantFrom(...dnsRuleHosts))
                  .map(([s, h]) => `${s}..${h}`),
                fc
                  .tuple(validLabelArb, fc.constantFrom(...dnsRuleHosts))
                  .map(([s, h]) => `${s}-${h}`),
                fc.constantFrom(...dnsRuleHosts).map((h) => `${h}.evil.test`),
              ]
            : []),
          fc.constant("[::1]"),
          fc.constant("."),
          fc.constant(".."),
        );
        return fc.tuple(fc.constant(norm), buildHttpUrlArb(targetedHostArb));
      });

      fc.assert(
        fc.property(
          policyAndAdversarialUrlArb,
          ([policy, url]: [NormalizedDomainPolicy, string]) => {
            const rules = toDomainPolicyDnrRules(policy);
            const decision = getDomainPolicyDecision(url, policy);
            const dnr = evaluateDnrRules(rules, url);

            expect(dnr).toBe(decision.action);
          },
        ),
        { numRuns: 500 },
      );
    });

    it("leaves all non-HTTP(S) URLs outside both decision and DNR enforcement", () => {
      fc.assert(
        fc.property(nonEmptyPolicyArb, nonHttpUrlArb, (rawPolicy, url) => {
          const policy = normalizeDomainPolicy(rawPolicy);
          const rules = toDomainPolicyDnrRules(policy);
          expect(getDomainPolicyDecision(url, policy)).toEqual({ action: "continue" });
          expect(evaluateDnrRules(rules, url)).toBe("continue");
        }),
        { numRuns: 200 },
      );
    });

    it("blocks dot-only hostnames in both getDomainPolicyDecision and DNR under allowlists", () => {
      fc.assert(
        fc.property(
          fc.array(messyPatternArb, { minLength: 1, maxLength: 3 }),
          schemeArb,
          userinfoArb,
          fc.integer({ min: 1, max: 4 }).map((n) => ".".repeat(n)),
          portArb,
          pathTailArb,
          (allowedDomains, scheme, userinfo, dotHost, port, tail) => {
            const allowPolicy = normalizeDomainPolicy({ allowedDomains });
            const allowRules = toDomainPolicyDnrRules(allowPolicy);
            const blockOnlyPolicy = normalizeDomainPolicy({ blockedDomains: allowedDomains });
            const blockOnlyRules = toDomainPolicyDnrRules(blockOnlyPolicy);
            const url = new URL(`${scheme}://${userinfo}${dotHost}${port}${tail}`).href;

            expect(getDomainPolicyDecision(url, allowPolicy)).toEqual({
              action: "block",
              reason: "allowedDomains",
            });
            expect(evaluateDnrRules(allowRules, url)).toBe("block");

            expect(getDomainPolicyDecision(url, blockOnlyPolicy)).toEqual({
              action: "continue",
            });
            expect(evaluateDnrRules(blockOnlyRules, url)).toBe("continue");
          },
        ),
        { numRuns: 100 },
      );
    });

    it("demonstrates GURL precondition: raw unserialized URLs evade raw regex without URL serialization", () => {
      fc.assert(
        fc.property(
          validHostnameArb,
          schemeArb,
          fc.constantFrom("?q=1", "#frag", ":/"),
          (domain, scheme, rawSuffix) => {
            const policy = normalizeDomainPolicy({ blockedDomains: [domain] });
            const rules = toDomainPolicyDnrRules(policy);
            const rawUrl = `${scheme}://${domain}${rawSuffix}`;
            const serializedUrl = new URL(rawUrl).href;

            expect(getDomainPolicyDecision(rawUrl, policy).action).toBe("block");
            expect(evaluateDnrRules(rules, rawUrl)).toBe("continue");
            expect(evaluateDnrRules(rules, serializedUrl)).toBe("block");
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  describe("malformed input fail-fast", () => {
    it("rejects undefined policy, non-object top-level inputs, and non-array fields", () => {
      expect(() => normalizeDomainPolicy(undefined)).toThrow(TypeError);

      fc.assert(
        fc.property(
          fc.oneof(
            fc.string(),
            fc.integer(),
            fc.boolean(),
            fc.array(fc.string(), { minLength: 0, maxLength: 3 }),
          ),
          (nonObjectPolicy) => {
            expect(() => normalizeDomainPolicy(nonObjectPolicy as unknown as DomainPolicy)).toThrow(
              TypeError,
            );
          },
        ),
        { numRuns: 100 },
      );

      fc.assert(
        fc.property(
          fc.oneof(
            fc.string(),
            fc.integer(),
            fc.boolean(),
            fc.constant(null),
            fc.dictionary(fc.string(), fc.string()),
          ),
          fc.constantFrom("allowedDomains" as const, "blockedDomains" as const),
          (badValue, key) => {
            expect(() =>
              normalizeDomainPolicy({ [key]: badValue } as unknown as DomainPolicy),
            ).toThrow(TypeError);
          },
        ),
        { numRuns: 100 },
      );
    });

    it("rejects non-string pattern elements inside policy arrays", () => {
      fc.assert(
        fc.property(
          fc.oneof(
            fc.integer(),
            fc.boolean(),
            fc.constant(null),
            fc.constant(undefined),
            fc.object(),
          ),
          fc.constantFrom("allowedDomains" as const, "blockedDomains" as const),
          (badElement, key) => {
            expect(() =>
              normalizeDomainPolicy({ [key]: [badElement] } as unknown as DomainPolicy),
            ).toThrow(TypeError);
          },
        ),
        { numRuns: 100 },
      );
    });

    it("rejects malformed domain pattern strings (URLs, ports, paths, bad wildcards, invalid labels)", () => {
      const malformedPatternArb = fc.oneof(
        fc.constantFrom("", "   ", ".", "..", "*.", "*..example.com", "*"),
        validLabelArb,
        validHostnameArb.map((h) => `https://${h}`),
        validHostnameArb.map((h) => `${h}/path`),
        validHostnameArb.map((h) => `${h}:8080`),
        validHostnameArb.map((h) => `${h}?a=1`),
        validHostnameArb.map((h) => `${h}#frag`),
        validHostnameArb.map((h) => `*${h}`),
        validHostnameArb.map((h) => `sub.*.${h}`),
        validHostnameArb.map((h) => `${h}.*`),
        validHostnameArb.map((h) => `-bad.${h}`),
        validHostnameArb.map((h) => `bad-.${h}`),
        fc.constant(`${"a".repeat(64)}.example.com`),
        fc.constant(`${"a".repeat(63)}.${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(63)}.com`),
        fc.constant("bücher.test"),
      );

      fc.assert(
        fc.property(
          malformedPatternArb,
          fc.constantFrom("allowedDomains" as const, "blockedDomains" as const),
          (pattern, key) => {
            expect(() => normalizeDomainPolicy({ [key]: [pattern] })).toThrow(TypeError);
          },
        ),
        { numRuns: 200 },
      );
    });
  });
});

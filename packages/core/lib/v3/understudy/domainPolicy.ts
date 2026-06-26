import type { Protocol } from "devtools-protocol";
import { StagehandInvalidArgumentError } from "../types/public/sdkErrors.js";
import type { DomainPolicy } from "../types/public/context.js";

type DomainRule =
  | { type: "exact"; hostname: string }
  | { type: "wildcard"; hostname: string };

export type NormalizedDomainPolicy = {
  allowedDomains: string[];
  blockedDomains: string[];
  allowedDomainRules: DomainRule[];
  blockedDomainRules: DomainRule[];
  fetchPatterns: Protocol.Fetch.RequestPattern[];
};

export type DomainPolicyDecision =
  | { action: "continue" }
  | { action: "block"; reason: "allowedDomains" | "blockedDomains" };

const DOMAIN_LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const HTTP_SCHEMES = ["http", "https"] as const;

function canonicalizeHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/\.+$/, "");
}

function policyFieldLabel(kind: "allowedDomains" | "blockedDomains"): string {
  return kind === "allowedDomains" ? "Allowed" : "Blocked";
}

function policyRuleLabel(kind: "allowedDomains" | "blockedDomains"): string {
  return kind === "allowedDomains" ? "allowed" : "blocked";
}

function validateHostname(
  hostname: string,
  original: string,
  kind: "allowedDomains" | "blockedDomains",
): void {
  if (!hostname || hostname.length > 253) {
    throw new StagehandInvalidArgumentError(
      `Invalid ${policyRuleLabel(kind)} domain pattern: "${original}"`,
    );
  }

  const labels = hostname.split(".");
  if (
    labels.length < 2 ||
    labels.some((label) => !DOMAIN_LABEL_RE.test(label))
  ) {
    throw new StagehandInvalidArgumentError(
      `Invalid ${policyRuleLabel(kind)} domain pattern: "${original}"`,
    );
  }
}

function normalizeDomainPattern(
  pattern: unknown,
  kind: "allowedDomains" | "blockedDomains",
): DomainRule {
  if (typeof pattern !== "string") {
    throw new StagehandInvalidArgumentError(
      `${policyFieldLabel(kind)} domain patterns must be strings`,
    );
  }

  const original = pattern;
  const normalized = canonicalizeHostname(pattern.trim());

  if (!normalized) {
    throw new StagehandInvalidArgumentError(
      `Invalid ${policyRuleLabel(kind)} domain pattern: "${original}"`,
    );
  }

  if (
    normalized.includes("://") ||
    normalized.includes("/") ||
    normalized.includes(":") ||
    normalized.includes("?") ||
    normalized.includes("#")
  ) {
    throw new StagehandInvalidArgumentError(
      `${policyFieldLabel(kind)} domain patterns must be domain-only values: "${original}"`,
    );
  }

  if (normalized.startsWith("*.")) {
    const hostname = normalized.slice(2);
    validateHostname(hostname, original, kind);
    return { type: "wildcard", hostname };
  }

  if (normalized.includes("*")) {
    throw new StagehandInvalidArgumentError(
      `Wildcards are only supported as a leading "*.": "${original}"`,
    );
  }

  validateHostname(normalized, original, kind);
  return { type: "exact", hostname: normalized };
}

function normalizeDomainPatterns(
  patterns: unknown[] | undefined,
  kind: "allowedDomains" | "blockedDomains",
): DomainRule[] {
  if (!patterns?.length) return [];

  const rulesByKey = new Map<string, DomainRule>();
  for (const pattern of patterns) {
    const rule = normalizeDomainPattern(pattern, kind);
    rulesByKey.set(`${rule.type}:${rule.hostname}`, rule);
  }

  return Array.from(rulesByKey.values());
}

function patternHost(rule: DomainRule): string {
  return rule.type === "wildcard" ? `*.${rule.hostname}` : rule.hostname;
}

function fetchPatternHosts(rule: DomainRule): string[] {
  const host = patternHost(rule);
  return [host, `${host}.`];
}

function toBlocklistFetchPatterns(
  rules: DomainRule[],
): Protocol.Fetch.RequestPattern[] {
  const patterns: Protocol.Fetch.RequestPattern[] = [];

  for (const rule of rules) {
    for (const host of fetchPatternHosts(rule)) {
      for (const scheme of HTTP_SCHEMES) {
        patterns.push({
          urlPattern: `${scheme}://${host}/*`,
          requestStage: "Request",
        });
        patterns.push({
          urlPattern: `${scheme}://${host}:*/*`,
          requestStage: "Request",
        });
      }
    }
  }

  return patterns;
}

function toAllowlistFetchPatterns(): Protocol.Fetch.RequestPattern[] {
  return HTTP_SCHEMES.map((scheme) => ({
    urlPattern: `${scheme}://*/*`,
    requestStage: "Request",
  }));
}

export function normalizeDomainPolicy(
  policy: DomainPolicy | null,
): NormalizedDomainPolicy | null {
  if (!policy?.allowedDomains?.length && !policy?.blockedDomains?.length) {
    return null;
  }

  const allowedDomainRules = normalizeDomainPatterns(
    policy.allowedDomains,
    "allowedDomains",
  );
  const blockedDomainRules = normalizeDomainPatterns(
    policy.blockedDomains,
    "blockedDomains",
  );
  if (!allowedDomainRules.length && !blockedDomainRules.length) return null;

  return {
    allowedDomains: allowedDomainRules.map(patternHost),
    blockedDomains: blockedDomainRules.map(patternHost),
    allowedDomainRules,
    blockedDomainRules,
    fetchPatterns: allowedDomainRules.length
      ? toAllowlistFetchPatterns()
      : toBlocklistFetchPatterns(blockedDomainRules),
  };
}

function hostnameFromHttpUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return canonicalizeHostname(parsed.hostname);
  } catch {
    return null;
  }
}

export function shouldBlockUrl(
  url: string,
  policy: NormalizedDomainPolicy | null,
): boolean {
  return getDomainPolicyDecision(url, policy).action === "block";
}

function matchesDomainRules(hostname: string, rules: DomainRule[]): boolean {
  return rules.some((rule) => {
    if (rule.type === "exact") {
      return hostname === rule.hostname;
    }
    return hostname.endsWith(`.${rule.hostname}`);
  });
}

export function getDomainPolicyDecision(
  url: string,
  policy: NormalizedDomainPolicy | null,
): DomainPolicyDecision {
  if (!policy) return { action: "continue" };

  const hostname = hostnameFromHttpUrl(url);
  if (!hostname) return { action: "continue" };

  if (matchesDomainRules(hostname, policy.blockedDomainRules)) {
    return { action: "block", reason: "blockedDomains" };
  }

  if (
    policy.allowedDomainRules.length &&
    !matchesDomainRules(hostname, policy.allowedDomainRules)
  ) {
    return { action: "block", reason: "allowedDomains" };
  }

  return { action: "continue" };
}

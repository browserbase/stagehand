import type { Protocol } from "devtools-protocol";
import { StagehandInvalidArgumentError } from "../types/public/sdkErrors.js";
import type { DomainPolicy } from "../types/public/context.js";

type BlockedDomainRule =
  | { type: "exact"; hostname: string }
  | { type: "wildcard"; hostname: string };

export type NormalizedDomainPolicy = {
  blockedDomains: string[];
  blockedDomainRules: BlockedDomainRule[];
  fetchPatterns: Protocol.Fetch.RequestPattern[];
};

const DOMAIN_LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

function validateHostname(hostname: string, original: string): void {
  if (!hostname || hostname.length > 253) {
    throw new StagehandInvalidArgumentError(
      `Invalid blocked domain pattern: "${original}"`,
    );
  }

  const labels = hostname.split(".");
  if (
    labels.length < 2 ||
    labels.some((label) => !DOMAIN_LABEL_RE.test(label))
  ) {
    throw new StagehandInvalidArgumentError(
      `Invalid blocked domain pattern: "${original}"`,
    );
  }
}

function normalizeBlockedDomainPattern(pattern: string): BlockedDomainRule {
  const original = pattern;
  const normalized = pattern.trim().toLowerCase();

  if (!normalized) {
    throw new StagehandInvalidArgumentError(
      `Invalid blocked domain pattern: "${original}"`,
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
      `Blocked domain patterns must be domain-only values: "${original}"`,
    );
  }

  if (normalized.startsWith("*.")) {
    const hostname = normalized.slice(2);
    validateHostname(hostname, original);
    return { type: "wildcard", hostname };
  }

  if (normalized.includes("*")) {
    throw new StagehandInvalidArgumentError(
      `Wildcards are only supported as a leading "*.": "${original}"`,
    );
  }

  validateHostname(normalized, original);
  return { type: "exact", hostname: normalized };
}

function patternHost(rule: BlockedDomainRule): string {
  return rule.type === "wildcard" ? `*.${rule.hostname}` : rule.hostname;
}

function toFetchPatterns(
  rules: BlockedDomainRule[],
): Protocol.Fetch.RequestPattern[] {
  const patterns: Protocol.Fetch.RequestPattern[] = [];

  for (const rule of rules) {
    const host = patternHost(rule);
    for (const scheme of ["http", "https"]) {
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

  return patterns;
}

export function normalizeDomainPolicy(
  policy: DomainPolicy | null,
): NormalizedDomainPolicy | null {
  if (!policy?.blockedDomains?.length) return null;

  const rulesByKey = new Map<string, BlockedDomainRule>();
  for (const domain of policy.blockedDomains) {
    const rule = normalizeBlockedDomainPattern(domain);
    rulesByKey.set(`${rule.type}:${rule.hostname}`, rule);
  }

  const blockedDomainRules = Array.from(rulesByKey.values());
  if (!blockedDomainRules.length) return null;

  return {
    blockedDomains: blockedDomainRules.map(patternHost),
    blockedDomainRules,
    fetchPatterns: toFetchPatterns(blockedDomainRules),
  };
}

function hostnameFromHttpUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function shouldBlockUrl(
  url: string,
  policy: NormalizedDomainPolicy | null,
): boolean {
  if (!policy) return false;

  const hostname = hostnameFromHttpUrl(url);
  if (!hostname) return false;

  return policy.blockedDomainRules.some((rule) => {
    if (rule.type === "exact") {
      return hostname === rule.hostname;
    }
    return hostname.endsWith(`.${rule.hostname}`);
  });
}

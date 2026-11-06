import { toDomainPolicyDnrRules, type NormalizedDomainPolicy } from "./domainPolicy.js";

export type DomainPolicyRuleSession = {
  replace(policy: NormalizedDomainPolicy | null): Promise<void>;
  close(): Promise<void>;
};

export type DomainPolicyDnrApi = Pick<
  typeof chrome.declarativeNetRequest,
  "getSessionRules" | "updateSessionRules" | "isRegexSupported"
> & {
  readonly MAX_NUMBER_OF_SESSION_RULES: number;
  readonly MAX_NUMBER_OF_REGEX_RULES: number;
};

// Reserve this range exclusively for domain policies. Other extension features must
// use different IDs; recovering after a worker restart must not remove their rules.
export const DOMAIN_POLICY_RULE_ID_START = 1_000_000;
const DOMAIN_POLICY_RULE_ID_END = 1_010_000;

function isDomainPolicyRule(rule: chrome.declarativeNetRequest.Rule): boolean {
  return rule.id >= DOMAIN_POLICY_RULE_ID_START && rule.id < DOMAIN_POLICY_RULE_ID_END;
}

/** One manager per extension, with one active browser session at a time. */
export class DomainPolicyDnrManager {
  private tail: Promise<unknown> = Promise.resolve();
  private owner?: symbol;

  constructor(
    private readonly api: DomainPolicyDnrApi,
    private readonly extensionId: string,
  ) {}

  openSession(): Promise<DomainPolicyRuleSession> {
    return this.enqueue(async () => {
      // Session rules outlive the service worker. Remove any abandoned policy before
      // handing the browser to a new session.
      await this.replaceRules([]);
      const owner = Symbol("domain-policy");
      this.owner = owner;
      return {
        replace: (policy) => {
          const rules = this.compile(policy);
          return this.enqueue(async () => {
            if (this.owner !== owner) throw new Error("Domain policy session is no longer active");
            await this.replaceRules(rules);
          });
        },
        close: () =>
          this.enqueue(async () => {
            // A late close from an old connection must not clear its successor's rules.
            if (this.owner !== owner) return;
            await this.replaceRules([]);
            this.owner = undefined;
          }),
      };
    });
  }

  private compile(policy: NormalizedDomainPolicy | null): chrome.declarativeNetRequest.Rule[] {
    const rules = toDomainPolicyDnrRules(policy).map((rule) => ({
      ...rule,
      id: DOMAIN_POLICY_RULE_ID_START + rule.id,
    }));
    if (!rules.length) return rules;

    // Domain policy governs browsing, not the extension backend's model/telemetry
    // requests. Limit this exemption to our own extension AND requests without a tab.
    // Page and worker requests from web origins still receive the policy.
    rules.unshift({
      id: DOMAIN_POLICY_RULE_ID_START,
      priority: 4,
      action: { type: "allow" },
      condition: {
        regexFilter: "^https?://",
        isUrlFilterCaseSensitive: false,
        excludedResourceTypes: [],
        initiatorDomains: [this.extensionId],
        tabIds: [-1],
      },
    });
    return rules;
  }

  private async replaceRules(rules: chrome.declarativeNetRequest.Rule[]): Promise<void> {
    const existing = await this.api.getSessionRules();
    const owned = existing.filter(isDomainPolicyRule);
    const unrelated = existing.filter((rule) => !isDomainPolicyRule(rule));

    if (rules.length) {
      if (
        rules.some((rule) => !isDomainPolicyRule(rule)) ||
        unrelated.length + rules.length > this.api.MAX_NUMBER_OF_SESSION_RULES
      ) {
        throw new Error("Domain policy exceeds Chrome's session rule limit");
      }
      const regexRules = [...unrelated, ...rules].filter(
        (rule) => rule.condition.regexFilter !== undefined,
      );
      if (regexRules.length > this.api.MAX_NUMBER_OF_REGEX_RULES) {
        throw new Error("Domain policy exceeds Chrome's regex rule limit");
      }

      const regexes = new Map<string, chrome.declarativeNetRequest.RegexOptions>();
      for (const { condition } of rules) {
        if (condition.regexFilter === undefined) continue;
        const options = {
          regex: condition.regexFilter,
          isCaseSensitive: condition.isUrlFilterCaseSensitive ?? false,
          requireCapturing: false,
        };
        regexes.set(JSON.stringify(options), options);
      }
      await Promise.all(
        Array.from(regexes.values(), async (options) => {
          const result = await this.api.isRegexSupported(options);
          if (!result.isSupported) {
            throw new Error(
              "Chrome does not support a domain policy regex: " +
                (result.reason ?? "unknown reason"),
            );
          }
        }),
      );
    }

    if (!owned.length && !rules.length) return;
    // Chrome replaces the rules atomically. Rejection leaves the previous policy installed.
    await this.api.updateSessionRules({
      removeRuleIds: owned.map((rule) => rule.id),
      addRules: rules,
    });
  }

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const result = this.tail.then(work, work);
    this.tail = result.catch(() => undefined);
    return result;
  }
}

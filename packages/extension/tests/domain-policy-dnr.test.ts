import { describe, expect, it, vi } from "vitest";
import {
  DOMAIN_POLICY_RULE_ID_START,
  DomainPolicyDnrManager,
  type DomainPolicyDnrApi,
} from "../understudy/domainPolicyDnr.js";
import { normalizeDomainPolicy } from "../understudy/domainPolicy.js";

const extensionId = "abcdefghijklmnopabcdefghijklmnop";
const blocked = normalizeDomainPolicy({ blockedDomains: ["blocked.test"] });
const allowed = normalizeDomainPolicy({ allowedDomains: ["allowed.test"] });

function fixture(initial: chrome.declarativeNetRequest.Rule[] = []) {
  let installed = structuredClone(initial);
  const api = {
    MAX_NUMBER_OF_SESSION_RULES: 5000,
    MAX_NUMBER_OF_REGEX_RULES: 1000,
    getSessionRules: vi.fn(async () => structuredClone(installed)),
    isRegexSupported: vi.fn(
      async (
        _options: chrome.declarativeNetRequest.RegexOptions,
      ): Promise<chrome.declarativeNetRequest.IsRegexSupportedResult> => ({ isSupported: true }),
    ),
    updateSessionRules: vi.fn(async (options: chrome.declarativeNetRequest.UpdateRuleOptions) => {
      installed = [
        ...installed.filter((rule) => !options.removeRuleIds?.includes(rule.id)),
        ...structuredClone(options.addRules ?? []),
      ];
    }),
  } satisfies DomainPolicyDnrApi;
  return {
    api,
    manager: new DomainPolicyDnrManager(api, extensionId),
    installed: () => structuredClone(installed),
  };
}

function unrelatedRule(id = 42): chrome.declarativeNetRequest.Rule {
  return { id, action: { type: "block" }, condition: { urlFilter: "other.test" } };
}

describe("DomainPolicyDnrManager", () => {
  it("cleans abandoned domain rules on opening without deleting unrelated rules", async () => {
    const unrelated = unrelatedRule();
    const stale = { ...unrelatedRule(), id: DOMAIN_POLICY_RULE_ID_START + 12 };
    const f = fixture([unrelated, stale]);
    await f.manager.openSession();
    expect(f.installed()).toEqual([unrelated]);
    expect(f.api.updateSessionRules).toHaveBeenCalledWith({
      removeRuleIds: [stale.id],
      addRules: [],
    });
  });

  it("installs, atomically replaces, and clears only its own session rules", async () => {
    const unrelated = unrelatedRule();
    const f = fixture([unrelated]);
    const session = await f.manager.openSession();
    await session.replace(blocked);
    const oldIds = f
      .installed()
      .filter((rule) => rule.id !== unrelated.id)
      .map((rule) => rule.id);
    expect(oldIds).toHaveLength(2);

    await session.replace(allowed);
    expect(f.api.updateSessionRules).toHaveBeenLastCalledWith({
      removeRuleIds: oldIds,
      addRules: expect.arrayContaining([
        expect.objectContaining({ action: { type: "allow" }, priority: 2 }),
        expect.objectContaining({ action: { type: "block" }, priority: 1 }),
      ]),
    });
    expect(f.installed()).toHaveLength(4);
    expect(f.installed()).toContainEqual(unrelated);

    await session.replace(null);
    expect(f.installed()).toEqual([unrelated]);
    await session.close();
    expect(f.installed()).toEqual([unrelated]);
  });

  it("exempts only this extension's backend requests without exempting web workers", async () => {
    const f = fixture();
    const session = await f.manager.openSession();
    await session.replace(allowed);
    expect(f.installed().find((rule) => rule.id === DOMAIN_POLICY_RULE_ID_START)).toEqual({
      id: DOMAIN_POLICY_RULE_ID_START,
      priority: 4,
      action: { type: "allow" },
      condition: {
        regexFilter: "^https?://",
        isUrlFilterCaseSensitive: false,
        excludedResourceTypes: [],
        initiatorDomains: [extensionId],
        tabIds: [-1],
      },
    });
    for (const rule of f.installed().filter((rule) => rule.id !== DOMAIN_POLICY_RULE_ID_START)) {
      expect(rule.condition.tabIds).toBeUndefined();
      expect(rule.condition.initiatorDomains).toBeUndefined();
    }
  });

  it("checks Chrome regex support before updating and retains rules on validation failure", async () => {
    const f = fixture();
    const session = await f.manager.openSession();
    await session.replace(blocked);
    const previous = f.installed();
    f.api.updateSessionRules.mockClear();
    f.api.isRegexSupported.mockResolvedValue({ isSupported: false, reason: "memoryLimitExceeded" });

    await expect(session.replace(allowed)).rejects.toThrow("memoryLimitExceeded");
    expect(f.api.updateSessionRules).not.toHaveBeenCalled();
    expect(f.installed()).toEqual(previous);

    f.api.isRegexSupported.mockResolvedValue({ isSupported: true });
    await session.replace(allowed);
    expect(f.installed()).not.toEqual(previous);
    expect(f.api.isRegexSupported).toHaveBeenCalledWith({
      regex: "^https?://",
      isCaseSensitive: false,
      requireCapturing: false,
    });
  });

  it.each(["session", "regex"] as const)(
    "counts unrelated rules against the %s limit while allowing replacement and clearing",
    async (kind) => {
      const unrelated = { ...unrelatedRule(), condition: { regexFilter: "^https://other.test/" } };
      const f = fixture([unrelated]);
      const session = await f.manager.openSession();
      if (kind === "session") f.api.MAX_NUMBER_OF_SESSION_RULES = 3;
      else f.api.MAX_NUMBER_OF_REGEX_RULES = 3;
      await session.replace(blocked); // Two owned rules plus one unrelated rule fit.
      await session.replace(blocked); // Replacement must not double-count old rules.
      const previous = f.installed();
      await expect(session.replace(allowed)).rejects.toThrow(kind + " rule limit");
      expect(f.installed()).toEqual(previous);
      await session.replace(null);
      expect(f.installed()).toEqual([unrelated]);
    },
  );

  it("retains the installed policy when Chrome rejects an update, and permits a retry", async () => {
    const f = fixture();
    const session = await f.manager.openSession();
    await session.replace(blocked);
    const previous = f.installed();
    f.api.updateSessionRules.mockRejectedValueOnce(new Error("Chrome rejected update"));
    await expect(session.replace(allowed)).rejects.toThrow("Chrome rejected update");
    expect(f.installed()).toEqual(previous);
    await session.replace(allowed);
    expect(f.installed()).not.toEqual(previous);
  });

  it("serializes overlapping updates and close", async () => {
    const f = fixture();
    const session = await f.manager.openSession();
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const update = f.api.updateSessionRules.getMockImplementation()!;
    f.api.updateSessionRules.mockImplementationOnce(async (options) => {
      started.resolve();
      await release.promise;
      await update(options);
    });
    const first = session.replace(blocked);
    await started.promise;
    const second = session.replace(allowed);
    const closing = session.close();
    await Promise.resolve();
    expect(f.api.updateSessionRules).toHaveBeenCalledTimes(1);
    release.resolve();
    await Promise.all([first, second, closing]);
    expect(f.api.updateSessionRules).toHaveBeenCalledTimes(3);
    expect(f.installed()).toEqual([]);
    await expect(session.replace(blocked)).rejects.toThrow("no longer active");
  });

  it("does not let an old session clear or replace a newer session's rules", async () => {
    const f = fixture();
    const first = await f.manager.openSession();
    await first.replace(blocked);
    const second = await f.manager.openSession();
    expect(f.installed()).toEqual([]);
    await second.replace(allowed);
    const previous = f.installed();
    await first.close();
    await expect(first.replace(blocked)).rejects.toThrow("no longer active");
    expect(f.installed()).toEqual(previous);
  });

  it("retries failed cleanup and makes successful cleanup idempotent", async () => {
    const f = fixture();
    const session = await f.manager.openSession();
    await session.replace(blocked);
    f.api.updateSessionRules.mockRejectedValueOnce(new Error("cleanup failed"));
    await expect(session.close()).rejects.toThrow("cleanup failed");
    expect(f.installed()).toHaveLength(2);
    await session.close();
    await session.close();
    expect(f.installed()).toEqual([]);
  });

  it("does not transfer ownership if startup cleanup fails", async () => {
    const f = fixture();
    const first = await f.manager.openSession();
    await first.replace(blocked);
    f.api.updateSessionRules.mockRejectedValueOnce(new Error("cleanup failed"));
    await expect(f.manager.openSession()).rejects.toThrow("cleanup failed");
    await first.replace(allowed);
    expect(f.installed()).toHaveLength(3);
  });
});

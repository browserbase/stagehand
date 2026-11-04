import { describe, expect, it, vi } from "vitest";
import { BrowserContext } from "../understudy/context.js";
import type { CdpConnection } from "../understudy/cdp.js";
import type { ChromeTabTargetController } from "../understudy/chromeTabs.js";
import type { StagehandLogger } from "../logger.js";
import type { DomainPolicyRuleSession } from "../understudy/domainPolicyDnr.js";
import type { NormalizedDomainPolicy } from "../understudy/domainPolicy.js";

const oldPolicy = { blockedDomains: ["old.test"] };
const newPolicy = { allowedDomains: ["new.test"] };

function fixture(withPage = true) {
  let installed: NormalizedDomainPolicy | null = null;
  const rules = {
    replace: vi.fn(async (policy: NormalizedDomainPolicy | null) => {
      installed = policy;
    }),
    close: vi.fn(async () => {
      installed = null;
    }),
  } satisfies DomainPolicyRuleSession;
  const page = {
    id: "page",
    send: vi.fn(async (_method: string, _params?: object) => ({})),
    on: vi.fn(),
    off: vi.fn(),
  };
  const conn = {
    getSession: vi.fn(() => page),
    close: vi.fn(async () => {}),
  };
  const logger = { error: vi.fn(), debug: vi.fn() };
  const context = new BrowserContext(
    conn as unknown as CdpConnection,
    logger as unknown as StagehandLogger,
    {} as ChromeTabTargetController,
    "LOCAL",
    null,
    "about:blank",
    null,
    rules,
  );
  if (withPage) context._sessionInit.add(page.id);
  return { context, rules, page, conn, installed: () => installed };
}

describe("BrowserContext DNR policy lifecycle", () => {
  it("installs and clears DNR rules even when there are no attached pages", async () => {
    const f = fixture(false);
    await f.context.setDomainPolicy(oldPolicy);
    expect(f.installed()?.blockedDomains).toEqual(["old.test"]);
    expect(f.context.getDomainPolicy()).toEqual(oldPolicy);
    expect(f.page.send).not.toHaveBeenCalled();
    await f.context.setDomainPolicy(null);
    expect(f.installed()).toBeNull();
    expect(f.context.getDomainPolicy()).toBeNull();
  });

  it("waits for DNR installation before publishing the policy and retains Fetch enforcement", async () => {
    const f = fixture();
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const replace = f.rules.replace.getMockImplementation()!;
    f.rules.replace.mockImplementationOnce(async (policy) => {
      started.resolve();
      await release.promise;
      await replace(policy);
    });
    const setting = f.context.setDomainPolicy(oldPolicy);
    await started.promise;
    expect(f.context.getDomainPolicy()).toBeNull();
    expect(f.page.send).not.toHaveBeenCalled();
    release.resolve();
    await setting;
    expect(f.context.getDomainPolicy()).toEqual(oldPolicy);
    expect(f.page.send).toHaveBeenCalledWith("Fetch.enable", {
      patterns: f.installed()?.fetchPatterns,
    });
    expect(f.page.on).toHaveBeenCalledWith("Fetch.requestPaused", expect.any(Function));

    await f.context.setDomainPolicy(null);
    expect(f.page.send).toHaveBeenLastCalledWith("Fetch.disable");
    expect(f.page.off).toHaveBeenCalledWith("Fetch.requestPaused", expect.any(Function));
  });

  it("leaves both the reported policy and Fetch configuration unchanged if DNR fails", async () => {
    const f = fixture();
    await f.context.setDomainPolicy(oldPolicy);
    f.page.send.mockClear();
    f.rules.replace.mockRejectedValueOnce(new Error("DNR rejected"));
    await expect(f.context.setDomainPolicy(newPolicy)).rejects.toThrow("DNR rejected");
    expect(f.context.getDomainPolicy()).toEqual(oldPolicy);
    expect(f.installed()?.blockedDomains).toEqual(["old.test"]);
    expect(f.page.send).not.toHaveBeenCalled();
    await f.context.setDomainPolicy(newPolicy);
    expect(f.context.getDomainPolicy()).toEqual(newPolicy);
  });

  it("restores the previous DNR and Fetch policy if Fetch configuration fails", async () => {
    const f = fixture();
    await f.context.setDomainPolicy(oldPolicy);
    f.page.send.mockRejectedValueOnce(new Error("Fetch rejected"));
    await expect(f.context.setDomainPolicy(newPolicy)).rejects.toThrow("Fetch rejected");
    expect(f.context.getDomainPolicy()).toEqual(oldPolicy);
    expect(f.installed()?.blockedDomains).toEqual(["old.test"]);
    expect(f.page.send).toHaveBeenLastCalledWith("Fetch.enable", {
      patterns: f.installed()?.fetchPatterns,
    });
  });

  it("reports rollback failures and keeps the getter consistent with the installed DNR policy", async () => {
    const f = fixture();
    await f.context.setDomainPolicy(oldPolicy);
    const replace = f.rules.replace.getMockImplementation()!;
    f.rules.replace
      .mockImplementationOnce(replace)
      .mockRejectedValueOnce(new Error("rollback failed"));
    f.page.send.mockRejectedValueOnce(new Error("Fetch rejected"));
    await expect(f.context.setDomainPolicy(newPolicy)).rejects.toThrow(
      "could not be fully rolled back",
    );
    expect(f.context.getDomainPolicy()).toEqual(newPolicy);
    expect(f.installed()?.allowedDomains).toEqual(["new.test"]);
  });

  it("rolls back a failed clear", async () => {
    const f = fixture();
    await f.context.setDomainPolicy(oldPolicy);
    f.page.send.mockRejectedValueOnce(new Error("disable rejected"));
    await expect(f.context.setDomainPolicy(null)).rejects.toThrow("disable rejected");
    expect(f.context.getDomainPolicy()).toEqual(oldPolicy);
    expect(f.installed()?.blockedDomains).toEqual(["old.test"]);
  });

  it("serializes updates through Fetch completion and snapshots caller input", async () => {
    const f = fixture();
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    f.page.send.mockImplementationOnce(async () => {
      started.resolve();
      await release.promise;
      return {};
    });
    const first = f.context.setDomainPolicy(oldPolicy);
    await started.promise;
    const input = { blockedDomains: ["second.test"] };
    const second = f.context.setDomainPolicy(input);
    input.blockedDomains.push("mutated.test");
    await Promise.resolve();
    expect(f.rules.replace).toHaveBeenCalledTimes(1);
    release.resolve();
    await Promise.all([first, second]);
    expect(f.context.getDomainPolicy()).toEqual({ blockedDomains: ["second.test"] });
  });

  it("rejects malformed policies without touching installed rules", async () => {
    const f = fixture();
    await f.context.setDomainPolicy(oldPolicy);
    await expect(
      f.context.setDomainPolicy({ blockedDomains: ["https://bad.test"] }),
    ).rejects.toThrow();
    expect(f.rules.replace).toHaveBeenCalledTimes(1);
    expect(f.context.getDomainPolicy()).toEqual(oldPolicy);
  });

  it("cleans up after an in-flight update and rejects updates after close starts", async () => {
    const f = fixture(false);
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const replace = f.rules.replace.getMockImplementation()!;
    f.rules.replace.mockImplementationOnce(async (policy) => {
      started.resolve();
      await release.promise;
      await replace(policy);
    });
    const setting = f.context.setDomainPolicy(oldPolicy);
    await started.promise;
    const closing = f.context.close();
    await expect(f.context.setDomainPolicy(newPolicy)).rejects.toThrow("closing");
    release.resolve();
    await Promise.all([setting, closing]);
    expect(f.rules.close).toHaveBeenCalledOnce();
    expect(f.installed()).toBeNull();
    expect(f.context.getDomainPolicy()).toBeNull();
    await f.context.close();
    expect(f.rules.close).toHaveBeenCalledOnce();
  });

  it("retries cleanup failure and still disconnects CDP", async () => {
    const f = fixture(false);
    await f.context.setDomainPolicy(oldPolicy);
    f.rules.close.mockRejectedValueOnce(new Error("cleanup rejected"));
    await expect(f.context.close()).rejects.toThrow("cleanup rejected");
    expect(f.conn.close).toHaveBeenCalledOnce();
    await f.context.close();
    expect(f.installed()).toBeNull();
  });

  it("cleans rules even if disconnecting CDP fails", async () => {
    const f = fixture(false);
    await f.context.setDomainPolicy(oldPolicy);
    f.conn.close.mockRejectedValueOnce(new Error("disconnect failed"));
    await expect(f.context.close()).rejects.toThrow("disconnect failed");
    expect(f.installed()).toBeNull();
    expect(f.rules.close).toHaveBeenCalledOnce();
  });
});

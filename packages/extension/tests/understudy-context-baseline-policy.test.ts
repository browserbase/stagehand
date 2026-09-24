import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Protocol } from "devtools-protocol";
import type { ChromeTabTargetController } from "../understudy/chromeTabs.ts";
import { CdpConnection } from "../understudy/cdp.ts";
import { BrowserContext } from "../understudy/context.ts";
import { BASELINE_DOMAIN_POLICY } from "../understudy/domainPolicy.ts";
import { Page } from "../understudy/page.ts";

const SESSION_ID = "session-1";
const TARGET_ID = "target-1";

type FakeSession = {
  id: string;
  send: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
};

function createContext(opts: { failFetchEnable?: boolean } = {}) {
  const session: FakeSession = {
    id: SESSION_ID,
    send: vi.fn(async (method: string) => {
      if (method === "Fetch.enable" && opts.failFetchEnable) {
        throw new Error("Fetch.enable is not available");
      }
      return {};
    }),
    on: vi.fn(),
    off: vi.fn(),
    close: vi.fn(async () => {}),
  };
  const connectionState = {
    connected: true,
    on: vi.fn(),
    enableAutoAttach: vi.fn(async () => {}),
    getTargets: vi.fn(async (): Promise<unknown[]> => []),
    attachToTarget: vi.fn(async () => ({})),
    getSession: vi.fn((sessionId: string) => (sessionId === SESSION_ID ? session : undefined)),
    waitForSessionDispatch: vi.fn(async () => {}),
    send: vi.fn(async () => ({})),
  };
  const chromeTabs: ChromeTabTargetController = {
    activeTargetId: vi.fn(async () => undefined),
    targetIdForTabId: vi.fn(async () => undefined),
    tabIdForTargetId: vi.fn(async () => undefined),
    activateTarget: vi.fn(async () => {}),
  };
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const context = new BrowserContext(
    connectionState as unknown as CdpConnection,
    logger as never,
    chromeTabs,
  );
  return { connectionState, context, logger, session };
}

function pageInfo(): Protocol.Target.TargetInfo {
  return {
    targetId: TARGET_ID,
    type: "page",
    title: "page",
    url: "https://example.com/",
    attached: true,
    canAccessOpener: false,
  };
}

function pausedRequest(requestId: string, url: string): Protocol.Fetch.RequestPausedEvent {
  return { requestId, request: { url } } as Protocol.Fetch.RequestPausedEvent;
}

function requestPausedHandler(
  session: FakeSession,
): (evt: Protocol.Fetch.RequestPausedEvent) => void {
  const call = session.on.mock.calls.find(([event]) => event === "Fetch.requestPaused");
  if (!call) throw new Error("Fetch.requestPaused handler was not installed");
  return call[1] as (evt: Protocol.Fetch.RequestPausedEvent) => void;
}

describe("BrowserContext default domain policy", () => {
  beforeEach(() => {
    // The attach flow under test runs before Page.create; the harness stops there.
    vi.spyOn(Page, "create").mockRejectedValue(
      new Error("Page.create is not part of this harness"),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("enables the baseline patterns when no policy is configured", async () => {
    const { context, session } = createContext();

    await context.onAttachedToTarget(pageInfo(), SESSION_ID);

    expect(session.send).toHaveBeenCalledWith("Fetch.enable", {
      patterns: BASELINE_DOMAIN_POLICY.fetchPatterns,
    });
    expect(context._domainPolicySessionListeners.has(SESSION_ID)).toBe(true);
    expect(session.on).toHaveBeenCalledWith("Fetch.requestPaused", expect.any(Function));
  });

  it("warns once per context when the baseline blocks requests", async () => {
    const { context, logger, session } = createContext();
    await context.onAttachedToTarget(pageInfo(), SESSION_ID);
    const handler = requestPausedHandler(session);

    handler(pausedRequest("request-1", "http://169.254.169.254/latest/meta-data/"));
    handler(pausedRequest("request-2", "http://metadata.google.internal/computeMetadata/v1/"));

    expect(logger.warn).toHaveBeenCalledOnce();
    expect(logger.warn).toHaveBeenCalledWith(
      "Blocked a request to a metadata or link-local host by the default domain policy. " +
        "Call context.setDomainPolicy({ allowedDomains: [...] }) to allow a host, or set a policy to replace the default.",
      { category: "network", hostname: "169.254.169.254", ruleType: "blockedDomains" },
    );
    expect(session.send).toHaveBeenCalledWith("Fetch.failRequest", {
      requestId: "request-1",
      errorReason: "BlockedByClient",
    });
    expect(session.send).toHaveBeenCalledWith("Fetch.failRequest", {
      requestId: "request-2",
      errorReason: "BlockedByClient",
    });
  });

  it("keeps the target running when Fetch.enable fails with no policy configured", async () => {
    const { connectionState, context, logger } = createContext({ failFetchEnable: true });

    await context.onAttachedToTarget(pageInfo(), SESSION_ID);

    expect(logger.error).toHaveBeenCalledWith(
      "Fetch.enable failed during target attach; continuing without domain policy enforcement",
      expect.objectContaining({
        targetId: TARGET_ID,
        sessionId: SESSION_ID,
        cdpError: "Fetch.enable is not available",
      }),
    );
    expect(connectionState.send).not.toHaveBeenCalledWith("Target.closeTarget", expect.anything());
    expect(context._domainPolicySessionListeners.has(SESSION_ID)).toBe(false);
  });

  it("closes the target when Fetch.enable fails with a policy configured", async () => {
    const { connectionState, context, logger } = createContext({ failFetchEnable: true });
    await context.setDomainPolicy({ blockedDomains: ["x.test"] });

    await context.onAttachedToTarget(pageInfo(), SESSION_ID);

    expect(logger.error).toHaveBeenCalledWith(
      "Closing target because domain policy could not be guaranteed",
      expect.objectContaining({
        targetId: TARGET_ID,
        sessionId: SESSION_ID,
        cdpError: "Fetch.enable is not available",
      }),
    );
    expect(connectionState.send).toHaveBeenCalledWith("Target.closeTarget", {
      targetId: TARGET_ID,
    });
    expect(context._domainPolicySessionListeners.has(SESSION_ID)).toBe(false);
  });

  it("keeps the baseline when an empty policy is applied", async () => {
    const { context, logger } = createContext();

    await context.setDomainPolicy({});

    expect(logger.info).not.toHaveBeenCalled();
    expect(context.domainPolicy).toBeNull();
  });

  it("logs the replacement when a policy replaces the baseline", async () => {
    const { context, logger } = createContext();

    await context.setDomainPolicy({ blockedDomains: ["x.test"] });

    expect(logger.info).toHaveBeenCalledWith(
      "Explicit domain policy replaces the default metadata and link-local blocklist",
      { category: "network" },
    );
  });
});

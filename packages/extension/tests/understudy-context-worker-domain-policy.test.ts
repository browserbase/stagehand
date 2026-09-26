import type { Protocol } from "devtools-protocol";
import { describe, expect, it, vi } from "vitest";
import type { ChromeTabTargetController } from "../understudy/chromeTabs.ts";
import type { CdpConnection, CDPSessionLike } from "../understudy/cdp.ts";
import { BrowserContext } from "../understudy/context.ts";
import { normalizeDomainPolicy } from "../understudy/domainPolicy.ts";

function createSession(id: string) {
  return {
    id,
    send: vi.fn(async () => ({})),
    on: vi.fn(),
    off: vi.fn(),
    close: vi.fn(async () => {}),
  } satisfies CDPSessionLike & { send: ReturnType<typeof vi.fn> };
}

function createContext() {
  const sessions = new Map<string, ReturnType<typeof createSession>>();
  const connectionState = {
    connected: true,
    on: vi.fn(),
    off: vi.fn(),
    send: vi.fn(async () => ({})),
    getSession: vi.fn((sessionId: string) => sessions.get(sessionId)),
    getTargets: vi.fn(async (): Promise<unknown[]> => []),
    enableAutoAttach: vi.fn(async () => {}),
  };
  const logger = { debug: vi.fn(), error: vi.fn() };
  const chromeTabs: ChromeTabTargetController = {
    activeTargetId: vi.fn(async () => undefined),
    targetIdForTabId: vi.fn(async () => undefined),
    tabIdForTargetId: vi.fn(async () => undefined),
    activateTarget: vi.fn(async () => {}),
  };
  return {
    sessions,
    connectionState,
    context: new BrowserContext(
      connectionState as unknown as CdpConnection,
      logger as never,
      chromeTabs,
    ),
    logger,
  };
}

function targetInfo(
  type: string,
  url = "http://127.0.0.1/service-worker.js",
): Protocol.Target.TargetInfo {
  return {
    targetId: `${type}-target`,
    type,
    title: "",
    url,
    attached: true,
    canAccessOpener: false,
  };
}

function fetchEnableCalls(session: ReturnType<typeof createSession>) {
  return session.send.mock.calls.filter(([method]) => method === "Fetch.enable");
}

describe("BrowserContext worker domain policy", () => {
  it("gates a service worker with the policy patterns", async () => {
    const { context, connectionState, sessions } = createContext();
    const session = createSession("sw-session");
    sessions.set("sw-session", session);
    await context.setDomainPolicy({ blockedDomains: ["blocked.test"] });

    await context.onAttachedToTarget(targetInfo("service_worker"), "sw-session");

    const enables = fetchEnableCalls(session);
    expect(enables).toHaveLength(1);
    expect(enables[0]?.[1]).toEqual({
      patterns: normalizeDomainPolicy({ blockedDomains: ["blocked.test"] })?.fetchPatterns,
    });
    expect(session.send).toHaveBeenCalledWith("Runtime.runIfWaitingForDebugger");
    expect(connectionState.getSession).toHaveBeenCalledWith("sw-session");
  });

  it("leaves the runtime's own service worker out of a page policy", async () => {
    const { context, sessions } = createContext();
    const session = createSession("extension-session");
    sessions.set("extension-session", session);
    await context.setDomainPolicy({ allowedDomains: ["allowed.test"] });

    await context.onAttachedToTarget(
      targetInfo("service_worker", "chrome-extension://abcdef/service-worker.js"),
      "extension-session",
    );

    expect(fetchEnableCalls(session)).toHaveLength(0);
  });

  it("leaves dedicated workers to the page session that already sees their requests", async () => {
    const { context, sessions } = createContext();
    const session = createSession("worker-session");
    sessions.set("worker-session", session);
    await context.setDomainPolicy({ blockedDomains: ["blocked.test"] });

    await context.onAttachedToTarget(targetInfo("worker"), "worker-session");

    expect(fetchEnableCalls(session)).toHaveLength(0);
    expect(session.send).toHaveBeenCalledWith("Runtime.runIfWaitingForDebugger");
  });

  it("enables the policy on a worker that attached before the policy was set", async () => {
    const { context, sessions } = createContext();
    const session = createSession("sw-session");
    sessions.set("sw-session", session);

    await context.onAttachedToTarget(targetInfo("service_worker"), "sw-session");
    expect(fetchEnableCalls(session)).toHaveLength(0);

    await context.setDomainPolicy({ blockedDomains: ["blocked.test"] });

    expect(fetchEnableCalls(session)).toHaveLength(1);
  });

  it("disables interception on a worker when the policy is cleared", async () => {
    const { context, sessions } = createContext();
    const session = createSession("sw-session");
    sessions.set("sw-session", session);
    await context.setDomainPolicy({ blockedDomains: ["blocked.test"] });
    await context.onAttachedToTarget(targetInfo("service_worker"), "sw-session");

    await context.setDomainPolicy(null);

    expect(session.send).toHaveBeenCalledWith("Fetch.disable");
  });
});

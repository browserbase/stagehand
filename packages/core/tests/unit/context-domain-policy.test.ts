import { afterEach, describe, expect, it, vi } from "vitest";
import { V3Context } from "../../lib/v3/understudy/context.js";
import { MockCDPSession } from "./helpers/mockCDPSession.js";
import { StagehandSetDomainPolicyError } from "../../lib/v3/types/public/sdkErrors.js";
import type { DomainPolicy } from "../../lib/v3/types/public/context.js";
import { normalizeDomainPolicy } from "../../lib/v3/understudy/domainPolicy.js";

type ContextStub = {
  _sessionInit: Set<string>;
  _domainPolicySessionListeners: Map<string, unknown>;
  conn: {
    getSession: (id: string) => MockCDPSession | undefined;
  };
  domainPolicy: unknown;
};

const makeContext = (sessions: MockCDPSession[]): ContextStub => {
  const sessionsById = new Map(
    sessions.map((session) => [session.id, session]),
  );
  return Object.assign(Object.create(V3Context.prototype), {
    _sessionInit: new Set(sessions.map((session) => session.id)),
    _domainPolicySessionListeners: new Map<string, unknown>(),
    conn: {
      getSession: (id: string) => sessionsById.get(id),
    },
    domainPolicy: null,
  }) as ContextStub;
};

const flushAsyncHandlers = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
};

describe("V3Context.setDomainPolicy", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const setDomainPolicy = V3Context.prototype.setDomainPolicy as (
    this: ContextStub,
    policy: DomainPolicy | null,
  ) => Promise<void>;
  const getDomainPolicy = V3Context.prototype.getDomainPolicy as (
    this: ContextStub,
  ) => DomainPolicy | null;

  it("sends Fetch.enable with generated patterns to all sessions", async () => {
    const sessionA = new MockCDPSession({}, "session-a");
    const sessionB = new MockCDPSession({}, "session-b");
    const ctx = makeContext([sessionA, sessionB]);

    await setDomainPolicy.call(ctx, {
      blockedDomains: ["ads.example.com"],
    });

    for (const session of [sessionA, sessionB]) {
      expect(session.listenerCount("Fetch.requestPaused")).toBe(1);
      expect(session.callsFor("Fetch.enable")[0]?.params).toEqual({
        patterns: [
          { urlPattern: "http://ads.example.com/*", requestStage: "Request" },
          {
            urlPattern: "http://ads.example.com:*/*",
            requestStage: "Request",
          },
          { urlPattern: "https://ads.example.com/*", requestStage: "Request" },
          {
            urlPattern: "https://ads.example.com:*/*",
            requestStage: "Request",
          },
          { urlPattern: "http://ads.example.com./*", requestStage: "Request" },
          {
            urlPattern: "http://ads.example.com.:*/*",
            requestStage: "Request",
          },
          {
            urlPattern: "https://ads.example.com./*",
            requestStage: "Request",
          },
          {
            urlPattern: "https://ads.example.com.:*/*",
            requestStage: "Request",
          },
        ],
      });
    }

    expect(getDomainPolicy.call(ctx)).toEqual({
      blockedDomains: ["ads.example.com"],
    });
  });

  it("sends Fetch.disable when policy is null or empty", async () => {
    const sessionA = new MockCDPSession({}, "session-a");
    const sessionB = new MockCDPSession({}, "session-b");
    const ctx = makeContext([sessionA, sessionB]);

    await setDomainPolicy.call(ctx, {
      blockedDomains: ["ads.example.com"],
    });
    await setDomainPolicy.call(ctx, null);
    await setDomainPolicy.call(ctx, { blockedDomains: [] });

    for (const session of [sessionA, sessionB]) {
      expect(session.callsFor("Fetch.disable").length).toBe(2);
      expect(session.listenerCount("Fetch.requestPaused")).toBe(0);
    }

    expect(getDomainPolicy.call(ctx)).toBeNull();
  });

  it("removes only its own requestPaused listener when disabled", async () => {
    const session = new MockCDPSession({}, "session-a");
    const ctx = makeContext([session]);
    const userHandler = () => {};
    session.on("Fetch.requestPaused", userHandler);

    await setDomainPolicy.call(ctx, {
      blockedDomains: ["ads.example.com"],
    });

    expect(session.listenerCount("Fetch.requestPaused")).toBe(2);

    await setDomainPolicy.call(ctx, null);

    expect(session.listenerCount("Fetch.requestPaused")).toBe(1);

    session.emit("Fetch.requestPaused", {
      requestId: "request-1",
      request: { url: "https://ads.example.com/script.js" },
    });
    await flushAsyncHandlers();

    expect(session.callsFor("Fetch.continueRequest").length).toBe(0);
    expect(session.callsFor("Fetch.failRequest").length).toBe(0);
  });

  it("throws a custom error with session failure details", async () => {
    const sessionA = new MockCDPSession(
      {
        "Fetch.enable": () => {
          throw new Error("boom");
        },
      },
      "session-a",
    );
    const sessionB = new MockCDPSession({}, "session-b");
    const ctx = makeContext([sessionA, sessionB]);

    const promise = setDomainPolicy.call(ctx, {
      blockedDomains: ["ads.example.com"],
    });

    await expect(promise).rejects.toBeInstanceOf(StagehandSetDomainPolicyError);

    try {
      await promise;
    } catch (error) {
      const err = error as StagehandSetDomainPolicyError;
      expect(err.failures).toHaveLength(1);
      expect(err.failures[0]).toContain("session=session-a");
      expect(err.failures[0]).toContain("boom");
    }

    expect(sessionA.callsFor("Fetch.enable").length).toBe(1);
    expect(sessionB.callsFor("Fetch.enable").length).toBe(1);
  });

  it("fails blocked paused requests", async () => {
    const session = new MockCDPSession({}, "session-a");
    const ctx = makeContext([session]);

    await setDomainPolicy.call(ctx, {
      blockedDomains: ["ads.example.com"],
    });

    session.emit("Fetch.requestPaused", {
      requestId: "request-1",
      request: { url: "https://ads.example.com/script.js" },
    });
    await flushAsyncHandlers();

    expect(session.callsFor("Fetch.failRequest")[0]?.params).toEqual({
      requestId: "request-1",
      errorReason: "BlockedByClient",
    });
  });

  it("continues unexpected non-blocked paused requests", async () => {
    const session = new MockCDPSession({}, "session-a");
    const ctx = makeContext([session]);

    await setDomainPolicy.call(ctx, {
      blockedDomains: ["ads.example.com"],
    });

    session.emit("Fetch.requestPaused", {
      requestId: "request-1",
      request: { url: "https://example.com/" },
    });
    await flushAsyncHandlers();

    expect(session.callsFor("Fetch.continueRequest")[0]?.params).toEqual({
      requestId: "request-1",
    });
  });

  it("closes new targets when Fetch.enable fails with an active policy", async () => {
    const session = new MockCDPSession(
      {
        "Fetch.enable": () => {
          throw new Error("fetch unavailable");
        },
      },
      "session-a",
    );
    const closeTargetCalls: unknown[] = [];
    const ctx = Object.assign(Object.create(V3Context.prototype), {
      _sessionInit: new Set<string>(),
      _targetSessionListeners: new Set<string>(),
      _domainPolicySessionListeners: new Map<string, unknown>(),
      _piercerInstalled: new Set<string>(),
      domainPolicy: normalizeDomainPolicy({
        blockedDomains: ["ads.example.com"],
      }),
      conn: {
        getSession: (id: string) => (id === session.id ? session : undefined),
        waitForSessionDispatch: () => Promise.resolve(),
        send: async (method: string, params?: unknown) => {
          if (method === "Target.closeTarget") closeTargetCalls.push(params);
          return {};
        },
      },
      pagesByTarget: new Map(),
      mainFrameToTarget: new Map(),
      sessionOwnerPage: new Map(),
      frameOwnerPage: new Map(),
      pendingOopifByMainFrame: new Map(),
      createdAtByTarget: new Map(),
      typeByTarget: new Map(),
      pendingCreatedTargetUrl: new Map([["target-a", "about:blank"]]),
      pageCreationFailures: new Map(),
      initScripts: [],
      extraHttpHeaders: null,
      localBrowserLaunchOptions: null,
      apiClient: null,
      env: "LOCAL",
    });

    const onAttachedToTarget = V3Context.prototype[
      "onAttachedToTarget" as keyof V3Context
    ] as unknown as (
      this: typeof ctx,
      info: {
        targetId: string;
        type: string;
        title: string;
        url: string;
        attached: boolean;
        canAccessOpener: boolean;
      },
      sessionId: string,
    ) => Promise<void>;

    await onAttachedToTarget.call(
      ctx,
      {
        targetId: "target-a",
        type: "page",
        title: "",
        url: "about:blank",
        attached: true,
        canAccessOpener: false,
      },
      session.id,
    );

    expect(closeTargetCalls).toEqual([{ targetId: "target-a" }]);
    expect(session.listenerCount("Fetch.requestPaused")).toBe(0);
    expect(session.callsFor("Page.getFrameTree").length).toBe(0);
    expect(ctx.pageCreationFailures.get("target-a")).toBeInstanceOf(
      StagehandSetDomainPolicyError,
    );
  });

  it("newPage throws stored attach failures without waiting for timeout", async () => {
    const ctx = Object.assign(Object.create(V3Context.prototype), {
      conn: {
        send: vi.fn(async (method: string) => {
          if (method === "Target.createTarget") {
            return { targetId: "target-a" };
          }
          return {};
        }),
      },
      pendingCreatedTargetUrl: new Map(),
      pageCreationFailures: new Map([
        ["target-a", new StagehandSetDomainPolicyError(["session=session-a"])],
      ]),
      pagesByTarget: new Map(),
    });
    const newPage = V3Context.prototype.newPage as (
      this: typeof ctx,
      url?: string,
    ) => Promise<unknown>;

    await expect(newPage.call(ctx)).rejects.toBeInstanceOf(
      StagehandSetDomainPolicyError,
    );
  });
});
